/**
 * Los nombres de Fleet vienen con espacios dobles, tildes inconsistentes y a
 * veces el prefijo "PPD". Para comparar conductores se usa esta forma.
 */
export function normalizarNombre(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^PPD\s+/i, '')
    .toUpperCase();
}

/** Nombre para mostrar: sin prefijo PPD ni espacios sobrantes, conserva tildes. */
export function limpiarNombre(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim().replace(/^PPD\s+/i, '');
  return t || null;
}
