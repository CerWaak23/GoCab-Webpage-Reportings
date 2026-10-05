/**
 * RUT chileno. Fleet lo entrega de varias formas ("153328234", "15.332.823-4",
 * "15332823-4", con espacios al final); acá se normaliza a una sola.
 */

/** "15.332.823-k " → "15332823K" */
export function limpiarRut(s) {
  return String(s ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function digitoVerificador(cuerpo) {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

export function rutValido(s) {
  const c = limpiarRut(s);
  if (c.length < 8 || c.length > 9) return false;
  const cuerpo = c.slice(0, -1);
  if (!/^\d+$/.test(cuerpo)) return false;
  return digitoVerificador(cuerpo) === c.slice(-1);
}

/** "153328234" → "15.332.823-4"; null si el RUT no es válido. */
export function formatearRut(s) {
  if (!rutValido(s)) return null;
  const c = limpiarRut(s);
  const cuerpo = c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${c.slice(-1)}`;
}
