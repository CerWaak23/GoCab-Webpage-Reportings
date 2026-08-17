export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { buscarConductor, nombreDePila } from '@/lib/flota';
import { crearTokenConductor, COOKIE_CONDUCTOR, SEGUNDOS_CONDUCTOR } from '@/lib/sesion-conductor';

// Un solo mensaje para todos los fallos: si distinguiera "patente no existe" de
// "RUT no coincide", la pantalla serviría para averiguar qué RUT maneja cada auto.
const ERROR = 'La patente o el RUT no coinciden. Revísalos e intenta de nuevo.';

// La patente es corta y adivinable, así que el freno acá importa más que en el
// portal interno. Es por instancia, no global: encarece el intento automatizado
// sin pretender ser una defensa completa.
const MAX_INTENTOS = 10;
const VENTANA_MS = 10 * 60 * 1000;
const intentos = new Map();

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

export async function POST(request) {
  try {
    const ip = ipDe(request);
    if (bloqueado(ip)) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const patente = body?.patente;
    const rut = body?.rut;

    if (!patente || !rut) {
      return NextResponse.json({ error: 'Escribe tu patente y tu RUT.' }, { status: 400 });
    }

    const conductor = await buscarConductor(patente, rut);
    if (!conductor) {
      registrarFallo(ip);
      return NextResponse.json({ error: ERROR }, { status: 401 });
    }

    intentos.delete(ip);
    // La planilla los guarda en mayúsculas y con prefijos de estado ("PPD JOSE
    // VIDELA"). Para saludar basta el nombre de pila y se lee mucho mejor.
    const token = await crearTokenConductor({
      patente: conductor.patente,
      nombre: nombreDePila(conductor.nombre),
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_CONDUCTOR, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SEGUNDOS_CONDUCTOR,
      path: '/',
    });
    return response;

  } catch (err) {
    console.error('[conductor/login]', err);
    return NextResponse.json({ error: 'Error interno. Intenta más tarde.' }, { status: 500 });
  }
}
