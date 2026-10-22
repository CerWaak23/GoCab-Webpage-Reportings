/**
 * Session helpers — cookie-based auth using HMAC-SHA256.
 * No external dependencies; works with the NEXTAUTH_SECRET env var.
 *
 * La firma y verificación del token viven en session-core.js, que no importa
 * `next/headers` y por eso también sirve dentro del middleware (runtime Edge).
 * Este archivo agrega el único helper que sí necesita el contexto de la request.
 */
import { cookies } from 'next/headers';
import {
  COOKIE_NAME,
  SESSION_SECONDS,
  createSessionToken,
  verifySessionToken,
} from './session-core';
import { buscarUsuario } from './usuarios';

// ── Server-Component helper ───────────────────────────────────────────────────

/**
 * Call from Server Components / Route Handlers to get the current session.
 * Returns { user: { email, name, gocabName, role, isManager } } or null.
 */
export async function getAppSession() {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  // La tabla de usuarios manda sobre lo que quedó en la cookie: si lo
  // desactivaron, la sesión deja de valer; si le cambiaron el rol, vale el nuevo.
  // Si la base no responde se usa lo de la cookie, para no dejar a todos afuera.
  const vivo = await buscarUsuario(payload.email);
  if (vivo.ok && !vivo.usuario) return null;
  const u = vivo.ok ? vivo.usuario : payload;

  return {
    user: {
      email: payload.email,
      name: u.name,
      gocabName: u.name,
      role: u.role,
      isManager: u.isManager,
    },
  };
}

export { COOKIE_NAME, SESSION_SECONDS, createSessionToken, verifySessionToken };
