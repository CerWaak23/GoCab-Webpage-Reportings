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

  return {
    user: {
      email: payload.email,
      name: payload.name,
      gocabName: payload.name,
      role: payload.role,
      isManager: payload.isManager,
    },
  };
}

export { COOKIE_NAME, SESSION_SECONDS, createSessionToken, verifySessionToken };
