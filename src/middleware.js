import { NextResponse } from 'next/server';
import { COOKIE_NAME, verifySessionToken } from '@/lib/session-core';
import { COOKIE_CONDUCTOR, verificarTokenConductor } from '@/lib/sesion-conductor';
import { rutaPausada } from '@/lib/pausado';
import { buscarUsuario } from '@/lib/usuarios';

/**
 * Rutas del equipo interno que responden sin sesión:
 *  - el login y el logout, obviamente;
 *  - /api/me, que ya devuelve { user: null } cuando no hay cookie y es lo que
 *    usan los reportes HTML para saber quién firmó cada paso;
 *  - /api/cron/*, porque el cron de Vercel no manda cookie. No queda abierto:
 *    esas rutas exigen el header Authorization con CRON_SECRET, o sesión de
 *    gerente si se lanzan a mano.
 * Todo el resto de /api queda cerrado. Antes estaba abierto: cualquiera que
 * supiera la URL podía hacer curl a /api/tolls o /api/fleet y bajarse la
 * planilla completa de flota y todos los peajes sin autenticarse.
 */
const PUBLIC_API = ['/api/auth/login', '/api/auth/logout', '/api/me', '/api/cron'];

// Portal de conductores: puerta aparte, con su propia cookie y su propia
// audiencia. Un token de conductor no abre nada del portal interno.
const CONDUCTOR_API_PUBLICA = ['/api/conductor/login', '/api/conductor/logout'];

function empieza(pathname, rutas) {
  return rutas.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Secciones en pausa (src/lib/pausado.js): no se abren ni por URL directa.
  if (rutaPausada(pathname)) {
    if (pathname.startsWith('/api')) return NextResponse.json({ error: 'No disponible' }, { status: 404 });
    return NextResponse.redirect(new URL(pathname.startsWith('/conductores') ? '/conductores/inicio' : '/dashboard', request.url));
  }

  // ── Portal de conductores ──────────────────────────────────────────────────
  if (empieza(pathname, CONDUCTOR_API_PUBLICA)) return NextResponse.next();

  const esApiConductor = pathname.startsWith('/api/conductor');
  const esPaginaConductor = pathname.startsWith('/conductores/');

  if (esApiConductor || esPaginaConductor) {
    const token = request.cookies.get(COOKIE_CONDUCTOR)?.value;
    const sesion = await verificarTokenConductor(token);
    if (sesion) return NextResponse.next();
    return esApiConductor
      ? NextResponse.json({ error: 'No autorizado' }, { status: 401 })
      : NextResponse.redirect(new URL('/conductores', request.url));
  }

  // ── Portal interno ─────────────────────────────────────────────────────────
  const esApi = pathname.startsWith('/api');
  if (esApi && empieza(pathname, PUBLIC_API)) return NextResponse.next();

  // Verificación HMAC completa, no solo "existe la cookie". Los reportes de
  // /reports son HTML estático servido desde public/, así que no hay Server
  // Component detrás que valide nada: si el middleware se conformara con la
  // presencia de la cookie, bastaba un document.cookie = 'gocab_session=x'
  // en la consola del navegador para abrir el dashboard financiero.
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (esApi) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Un usuario desactivado en la tabla `usuarios` sale aunque su cookie siga
  // vigente: los reportes HTML no tienen otra puerta que esta. Si la base no
  // responde se deja pasar a la sesión válida, para no cerrarle el portal a todos.
  const vivo = await buscarUsuario(session.email);
  if (vivo.ok && !vivo.usuario) {
    const salida = esApi
      ? NextResponse.json({ error: 'Usuario desactivado' }, { status: 401 })
      : NextResponse.redirect(new URL('/', request.url));
    salida.cookies.delete(COOKIE_NAME);
    return salida;
  }

  return NextResponse.next();
}

export const config = {
  // /conductores (la pantalla de ingreso) queda fuera a propósito: es pública.
  // Solo /conductores/... exige sesión de conductor.
  matcher: [
    '/dashboard/:path*',
    '/reports/:path*',
    '/api/:path*',
    '/conductores/:path+',
    '/historial/:path*',
    '/m/:path*',
  ],
};
