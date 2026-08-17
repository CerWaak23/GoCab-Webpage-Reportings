/**
 * Sesión del portal de conductores.
 *
 * Cookie propia y audiencia propia: un token de conductor no sirve en
 * /dashboard ni en /reports aunque lo peguen a mano, porque verificarToken
 * compara el campo "aud".
 */

import { cookies } from 'next/headers';
import { firmarToken, verificarToken } from './session-core';

export const COOKIE_CONDUCTOR = 'gocab_conductor';
export const AUD_CONDUCTOR = 'driver';

// 30 días: el conductor entra desde su propio celular y de vez en cuando.
// Pedirle patente y RUT cada semana sería la forma más rápida de que deje de usarlo.
export const SEGUNDOS_CONDUCTOR = 30 * 24 * 60 * 60;

export function crearTokenConductor({ patente, nombre }) {
  return firmarToken({ patente, nombre }, AUD_CONDUCTOR, SEGUNDOS_CONDUCTOR);
}

export function verificarTokenConductor(token) {
  return verificarToken(token, AUD_CONDUCTOR);
}

/** Para Server Components y Route Handlers. Devuelve { patente, nombre } o null. */
export async function getSesionConductor() {
  const token = cookies().get(COOKIE_CONDUCTOR)?.value;
  const payload = await verificarTokenConductor(token);
  if (!payload) return null;
  return { patente: payload.patente, nombre: payload.nombre };
}
