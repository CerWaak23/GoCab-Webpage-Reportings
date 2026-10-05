/**
 * Reglas de Configuración del Historial. Funciones puras con pruebas.
 */
import { rutValido, formatearRut } from '@/lib/rut';

/**
 * Revisa una checklist antes de guardarla como versión nueva (R10): grupos
 * con nombre y al menos un elemento, sin elementos vacíos ni repetidos (el
 * nombre del elemento es la clave con que se guarda cada respuesta).
 *
 * @param grupos [{ grupo, items: [string] }]
 * @returns { grupos: limpios } o { error }
 */
export function validarChecklist(grupos) {
  if (!Array.isArray(grupos) || grupos.length === 0) return { error: 'vacia' };
  const limpios = grupos.map((g) => ({
    grupo: String(g?.grupo || '').trim().replace(/\s+/g, ' '),
    items: (g?.items || []).map((i) => String(i || '').trim().replace(/\s+/g, ' ')).filter(Boolean),
  }));
  if (limpios.some((g) => !g.grupo)) return { error: 'grupo_sin_nombre' };
  if (limpios.some((g) => g.items.length === 0)) return { error: 'grupo_vacio' };
  const todos = limpios.flatMap((g) => g.items.map((i) => i.toLowerCase()));
  if (new Set(todos).size !== todos.length) return { error: 'repetido' };
  if (todos.length > 60) return { error: 'demasiados' };
  if (todos.some((i) => i.length > 80) || limpios.some((g) => g.grupo.length > 60)) return { error: 'largo' };
  return { grupos: limpios };
}

/** Dos checklists son iguales si tienen los mismos grupos y elementos en el mismo orden. */
export const mismaChecklist = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Valores editables de la tabla configuracion, con su validación. */
export const AJUSTES = {
  revision_dias: (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 7 && n <= 180 ? n : undefined;
  },
  telefono_asistencia_sura: (v) => {
    const t = String(v || '').trim();
    return /^[0-9 +()-]{6,20}$/.test(t) ? t : undefined;
  },
  rut_empresa: (v) => (rutValido(v) ? formatearRut(v) : undefined),
};

/** Valida un cambio de ajustes: { valores } con los que sirven, o { error: clave }. */
export function validarAjustes(cambios) {
  const valores = {};
  for (const [clave, valor] of Object.entries(cambios || {})) {
    if (!AJUSTES[clave]) return { error: clave };
    const v = AJUSTES[clave](valor);
    if (v === undefined) return { error: clave };
    valores[clave] = v;
  }
  return { valores };
}

/** El conductor solo ve y descarga actas de las que él es el conductor (R14, R35). */
export const actaEsDelConductor = (evento, conductorId) => !!conductorId && evento?.conductor_id === conductorId;

/** Una nota de corrección (R13): texto de 3 a 1000 caracteres. */
export const textoNotaValido = (texto) => {
  const t = String(texto || '').trim();
  return t.length >= 3 && t.length <= 1000;
};
