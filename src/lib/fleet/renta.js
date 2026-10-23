/**
 * Renta semanal por modelo de auto. Fleet la carga cada miércoles a las 14:00 y
 * cubre de jueves a miércoles: el conductor paga por adelantado la semana que va
 * a trabajar. El Balance del export de conductores queda en 0 si pagó todo y en
 * negativo por lo que le falta (-242.000 si no pagó la semana de un Nammi).
 */
export const RENTA_SEMANAL = [
  { marca: /baic/i, monto: 259000, modelo: 'BAIC' },
  { marca: /neta/i, monto: 210000, modelo: 'Neta' },
  { marca: /dongfeng|nammi/i, monto: 242000, modelo: 'Nammi' },
];

export function rentaDeAuto(marca, modelo) {
  const texto = `${marca || ''} ${modelo || ''}`;
  return RENTA_SEMANAL.find((r) => r.marca.test(texto)) || null;
}

/** "-120000", "$ -42.000", "194" → número; vacío → null. */
export function leerBalance(v) {
  let s = String(v ?? '').trim().replace(/[$\s]/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}
