/**
 * Una sola regla para comparar patentes en todo GoBills: mayúsculas y solo
 * letras y números. Antes la planilla de flota y la de talleres usaban reglas
 * distintas y los cruces fallaban con guiones o espacios.
 */
export function normalizarPatente(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Varias patentes en una celda ("VYKK33, VVCG35"): un conductor puede tener
 * su auto y uno de reemplazo. Se separan por coma, punto y coma, barra o
 * salto de línea, y por espacio solo si cada parte es una patente completa.
 */
export function leerPatentes(celda) {
  const partes = String(celda ?? '').split(/[,;|/\n]+/).flatMap((p) => {
    const trozos = p.trim().split(/\s+/);
    return trozos.length > 1 && trozos.every((t) => normalizarPatente(t).length >= 5) ? trozos : [p];
  });
  return [...new Set(partes.map(normalizarPatente).filter(Boolean))];
}
