import { NextResponse } from 'next/server';
import { getUserByEmail } from '@/lib/users';
import { createSessionToken, COOKIE_NAME, SESSION_SECONDS } from '@/lib/session-core';

// Contraseña única del portal, compartida por todo el equipo. Vive en la variable
// de entorno PORTAL_PASSWORD (local: .env.local — en Vercel: Settings →
// Environment Variables) y nunca en el código, para que no viaje al repo.
// Si algún día se quiere una clave por persona, basta mover el campo a USERS
// en lib/users.js y comparar contra user.password en vez de contra esta.
const ERROR_GENERICO = 'Email o contraseña incorrectos.';

// Freno de fuerza bruta. Es por instancia de función, así que en Vercel no es
// un límite global — solo encarece el intento automatizado, que es lo que busca.
const MAX_INTENTOS = 8;
const VENTANA_MS = 10 * 60 * 1000;
const intentos = new Map(); // ip → { count, resetAt }

function ipDe(request) {
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'desconocida';
}

function bloqueado(ip) {
  const reg = intentos.get(ip);
  if (!reg) return false;
  if (Date.now() > reg.resetAt) { intentos.delete(ip); return false; }
  return reg.count >= MAX_INTENTOS;
}

function registrarFallo(ip) {
  const reg = intentos.get(ip);
  if (!reg || Date.now() > reg.resetAt) {
    intentos.set(ip, { count: 1, resetAt: Date.now() + VENTANA_MS });
    return;
  }
  reg.count += 1;
}

/**
 * Comparación en tiempo constante: recorre siempre la cadena completa para que
 * el tiempo de respuesta no delate cuántos caracteres iniciales acertó quien
 * esté probando claves.
 */
function comparaSegura(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(String(a ?? ''));
  const bb = enc.encode(String(b ?? ''));
  let diff = ba.length ^ bb.length;
  const len = Math.max(ba.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function POST(request) {
  try {
    const ip = ipDe(request);
    if (bloqueado(ip)) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Espera unos minutos.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const email = body?.email?.trim()?.toLowerCase();
    const password = body?.password ?? '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email y contraseña son obligatorios.' }, { status: 400 });
    }

    const esperada = process.env.PORTAL_PASSWORD;
    if (!esperada) {
      console.error('[login] PORTAL_PASSWORD no está configurada');
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }

    const user = getUserByEmail(email);
    const passwordOk = comparaSegura(password, esperada);

    // Un solo mensaje para los dos casos: si el error distinguiera "email no
    // registrado" de "contraseña mala", la pantalla de login serviría para
    // averiguar qué correos tienen acceso al portal.
    if (!user || !passwordOk) {
      registrarFallo(ip);
      return NextResponse.json({ error: ERROR_GENERICO }, { status: 401 });
    }

    intentos.delete(ip);
    const token = await createSessionToken(user);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_SECONDS,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('[login]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
