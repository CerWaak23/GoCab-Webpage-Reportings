/**
 * Plan de pago de la garantía de los conductores en renta.
 *
 * Se entregan $50.000 con el auto y después $25.000 cada miércoles de pago,
 * hasta el tope. El miércoles de la semana (lunes a domingo) en que el conductor
 * partió no cobra cuota: la primera cae el miércoles siguiente, igual que el
 * bloque de peajes. Quien parte un lunes no paga los $25.000 dos días después.
 *
 * El tope es $250.000, salvo para los activados desde el 1 de septiembre de
 * 2026, que tienen que llegar a $300.000.
 *
 * Drive to own no paga garantía, así que para ellos no hay plan.
 */

export const ENTREGA = 50000;
export const CUOTA = 25000;
export const TOPE = 250000;
export const TOPE_NUEVOS = 300000;
export const DESDE_TOPE_NUEVOS = '2026-09-01';

const DIA = 86400000;
const aUTC = (iso) => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');

/**
 * Miércoles de pago ya terminados desde la activación hasta `hoy`. El miércoles
 * en curso todavía no cuenta: es el día para pagar, y contarlo desde la mañana
 * pondría a todos con una cuota atrasada antes de que alcancen a hacerlo.
 */
export function cuotasVencidas(activacion, hoy) {
  const ini = aUTC(activacion);
  const fin = aUTC(hoy);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin < ini) return 0;
  // Domingo que cierra la semana de la activación (0 = domingo)
  const domingo = ini + ((7 - new Date(ini).getUTCDay()) % 7) * DIA;
  const primerMiercoles = domingo + 3 * DIA;
  if (fin <= primerMiercoles) return 0;
  return Math.floor((fin - primerMiercoles - DIA) / (7 * DIA)) + 1;
}

export function topeDe(activacion) {
  return String(activacion || '').slice(0, 10) >= DESDE_TOPE_NUEVOS ? TOPE_NUEVOS : TOPE;
}

/**
 * @param c   { garantia, activacion, modalidad } del conductor
 * @param hoy 'YYYY-MM-DD' en hora de Chile
 * @returns null si no aplica o no hay datos; si no, el estado del plan.
 */
export function estadoGarantia(c, hoy) {
  if (!c) return null;
  if (c.modalidad === 'drive_to_own') return { aplica: false, modalidad: 'drive_to_own' };
  if (c.garantia == null || !c.activacion) return { aplica: true, sinDato: true };
  const tope = topeDe(c.activacion);
  const cuotas = cuotasVencidas(c.activacion, hoy);
  const debia = Math.min(ENTREGA + CUOTA * cuotas, tope);
  const pagada = Math.max(0, Math.round(Number(c.garantia) || 0));
  const falta = Math.max(0, debia - pagada);
  return {
    aplica: true,
    pagada,
    debia,
    tope,
    cuotas,
    falta,
    // Cuotas de $25.000 que faltan, contando la que está a medio pagar
    atraso: Math.ceil(falta / CUOTA),
    completa: pagada >= tope,
  };
}
