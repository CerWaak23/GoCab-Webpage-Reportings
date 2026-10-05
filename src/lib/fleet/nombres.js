/**
 * Los nombres de Fleet vienen con espacios dobles, tildes inconsistentes y a
 * veces el prefijo "PPD" (o "PDD", mal tipeado). Para comparar conductores se
 * usa esta forma.
 */
const PREFIJO = /^P[PD]D\s+/i;

export function normalizarNombre(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(PREFIJO, '')
    .toUpperCase();
}

/** Nombre para mostrar: sin prefijo PPD/PDD ni espacios sobrantes, conserva tildes. */
export function limpiarNombre(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim().replace(PREFIJO, '');
  return t || null;
}
