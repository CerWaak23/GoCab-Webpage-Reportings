/**
 * Una sola regla para comparar patentes en todo GoBills: mayúsculas y solo
 * letras y números. Antes la planilla de flota y la de talleres usaban reglas
 * distintas y los cruces fallaban con guiones o espacios.
 */
export function normalizarPatente(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
