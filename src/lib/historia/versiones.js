/**
 * Historia de bills y multas: qué filas de un export cambiaron respecto de la
 * última versión guardada de cada una. Antes lo calculaba la base y se volvía
 * más lento a medida que crecía la historia (migración 0016); ahora se calcula
 * acá y la base solo guarda las filas nuevas.
 *
 * Funciones puras con pruebas en tests/historia-versiones.test.js; la lectura
 * de la base y el guardado están en guardarHistoria().
 */

const txt = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => Number(v ?? 0);

/** Campos que cuentan como cambio, con cómo se leen de la fila del export y de la versión guardada. */
export const TIPOS = {
  bills: {
    tablaArchivos: 'bills_archivos',
    tablaVersiones: 'bills_versiones',
    funcion: 'guardar_bills_version',
    clave: (f) => f.referencia,
    claveGuardada: (v) => v.referencia,
    columnas: 'referencia, subido, tipo, estado, vehiculo, conductor, telefono, descripcion, monto, pagado, creado_texto',
    comparar: [
      ['tipo', 'tipo', txt], ['estado', 'estado', txt], ['vehiculo', 'vehiculo', txt], ['conductor', 'conductor', txt],
      ['telefono', 'telefono', txt], ['descripcion', 'descripcion', txt], ['monto', 'monto', num], ['pagado', 'pagado', num],
      ['creadoTexto', 'creado_texto', txt],
    ],
  },
  fines: {
    tablaArchivos: 'multas_archivos',
    tablaVersiones: 'multas_versiones',
    funcion: 'guardar_multas_version',
    clave: (f) => f.clave,
    claveGuardada: (v) => v.clave,
    columnas: 'clave, subido, base, referencia, fecha_contravencion, cargo, pago, estado, conductor, vehiculo, creado, descripcion',
    comparar: [
      ['base', 'base', txt], ['ref', 'referencia', txt], ['fechaContravencion', 'fecha_contravencion', txt],
      ['cargo', 'cargo', num], ['pago', 'pago', num], ['estado', 'estado', txt], ['conductor', 'conductor', txt],
      ['vehiculo', 'vehiculo', txt], ['creado', 'creado', txt], ['descripcion', 'descripcion', txt],
    ],
  },
};

/**
 * Última versión de cada fila subida antes de `subido` (así un export viejo
 * cargado tarde se compara con lo que había en su momento).
 */
export function ultimasAntesDe(guardadas, tipo, subido) {
  const t = TIPOS[tipo];
  const hasta = Date.parse(subido);
  const out = new Map();
  for (const v of guardadas) {
    if (Date.parse(v.subido) >= hasta) continue;
    const k = t.claveGuardada(v);
    const prev = out.get(k);
    if (!prev || Date.parse(v.subido) >= Date.parse(prev.subido)) out.set(k, v);
  }
  return out;
}

/**
 * Filas del export que hay que guardar: las que no estaban y las que cambiaron.
 * Cada una lleva su posición en el archivo (orden), que es el orden en que la
 * recorre el reporte.
 * @returns { versiones, nuevas, cambios }
 */
export function cambiosDelArchivo(filas, ultimas, tipo) {
  const t = TIPOS[tipo];
  const versiones = [];
  let nuevas = 0;
  let cambios = 0;
  filas.forEach((f, i) => {
    const k = t.clave(f);
    if (!k) return;
    const prev = ultimas.get(k);
    const distinta = !prev || t.comparar.some(([deFila, deGuardada, norm]) => norm(f[deFila]) !== norm(prev[deGuardada]));
    if (!distinta) return;
    if (prev) cambios++; else nuevas++;
    versiones.push({ ...f, orden: i + 1 });
  });
  return { versiones, nuevas, cambios };
}

/** Todas las versiones guardadas de un tipo (de a 1000, que es lo máximo por consulta). */
export async function versionesGuardadas(sb, tipo) {
  const t = TIPOS[tipo];
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(t.tablaVersiones).select(t.columnas).order('id').range(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

/**
 * Guarda un export en la historia. `guardadas` se puede pasar para no volver
 * a leer la base en cada archivo (la importación de Drive); se actualiza con
 * las versiones nuevas.
 *
 * @param archivo { archivo, driveId?, cargaId?, subido, origen, ...extra }  extra: datos propios del tipo
 * @param filas   las filas ya leídas (billsDeFilas o multasDeFilas().filas)
 */
export async function guardarHistoria(sb, tipo, archivo, filas, guardadas = null) {
  const t = TIPOS[tipo];
  const lista = guardadas ?? (await versionesGuardadas(sb, tipo));
  const { versiones, nuevas, cambios } = cambiosDelArchivo(filas, ultimasAntesDe(lista, tipo, archivo.subido), tipo);
  const extra = tipo === 'bills'
    ? {
        filas: filas.length,
        filasSinConductor: filas.filter((f) => !String(f.conductor || '').trim()).length,
        referencias: filas.map((f) => f.referencia).filter(Boolean),
      }
    : { filas: filas.length };
  const { data, error } = await sb.rpc(t.funcion, { p_archivo: { ...archivo, ...extra, nuevas, cambios }, p_versiones: versiones });
  if (error) throw new Error(error.message);
  if (guardadas && !data?.ya_registrado) {
    for (const v of versiones) {
      guardadas.push(tipo === 'bills'
        ? { ...v, subido: archivo.subido, creado_texto: v.creadoTexto }
        : { ...v, subido: archivo.subido, referencia: v.ref, fecha_contravencion: v.fechaContravencion });
    }
  }
  return data;
}
