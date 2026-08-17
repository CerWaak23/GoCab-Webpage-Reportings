import { NextResponse } from 'next/server';
import { COOKIE_NAME, verifySessionToken } from '@/lib/session-core';

/**
 * Rutas que tienen que responder sin sesión:
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

function esApiPublica(pathname) {
  return PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const esApi = pathname.startsWith('/api');

  if (esApi && esApiPublica(pathname)) return NextResponse.next();

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

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/reports/:path*', '/api/:path*'],
};
