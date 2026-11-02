/**
 * "Listado de TAGs" de la plataforma del GPS: una fila por pasada por pórtico.
 * Se usa en el navegador (lee el archivo, que pesa ~70 MB y no cabe en Storage)
 * y en el servidor (valida cada lote antes de guardarlo).
 *
 * Columnas: id, patente ("VSBH-40"), imei, fecha_entrada, fecha_salida,
 * tipo_autopista, autopista, portico, tipo_tarifa, valor_cobro (pesos enteros).
 * El id es el número de fila del export, no sirve para reconocer una pasada:
 * una pasada es patente + hora de entrada + pórtico.
 */

export const CAMPOS = ['patente', 'entrada', 'salida', 'imei', 'tipoAutopista', 'autopista', 'portico', 'tipoTarifa', 'valor'];

const ENCABEZADOS = {
  patente: ['patente'],
  imei: ['imei'],
  entrada: ['fecha_entrada', 'fecha entrada'],
  salida: ['fecha_salida', 'fecha salida'],
  tipoAutopista: ['tipo_autopista', 'tipo autopista'],
  autopista: ['autopista'],
  portico: ['portico', 'pórtico'],
  tipoTarifa: ['tipo_tarifa', 'tipo tarifa'],
  valor: ['valor_cobro', 'valor cobro'],
};
const OBLIGATORIAS = ['patente', 'entrada', 'portico', 'valor'];

/**
 * Busca la fila de títulos en las primeras filas y dónde está cada columna.
 * @returns { fila, col: { campo: índice } } o { error: 'formato', faltan }
 */
export function leerEncabezado(filas) {
  for (let i = 0; i < Math.min(10, filas.length); i++) {
    const titulos = (filas[i] || []).map((t) => String(t ?? '').trim().toLowerCase());
    if (!titulos.includes('patente')) continue;
    const col = {};
    for (const [campo, nombres] of Object.entries(ENCABEZADOS)) {
      const j = titulos.findIndex((t) => nombres.includes(t));
      if (j >= 0) col[campo] = j;
    }
    const faltan = OBLIGATORIAS.filter((c) => col[c] === undefined);
    return faltan.length ? { error: 'formato', faltan } : { fila: i, col };
  }
  return { error: 'formato', faltan: OBLIGATORIAS };
}

/** "VSBH-40" → "VSBH40" */
export function normalizarPatente(v) {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Fecha y hora tal como las escribe el GPS ("2026-03-01 02:18:55"), sin zona:
 * es hora de pórtico y así se guarda. Acepta también el serial de Excel.
 */
export function normalizarFechaHora(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 40000 && v < 60000) {
    const d = new Date(Math.round((v - 25569) * 86400) * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`;
}

/** Una fila del export como arreglo en el orden de CAMPOS, o null si no sirve. */
export function normalizarFila(r, col) {
  const patente = normalizarPatente(r[col.patente]);
  const entrada = normalizarFechaHora(r[col.entrada]);
  const valor = Math.round(Number(String(r[col.valor] ?? '').replace(/[^\d.-]/g, '')));
  if (!patente || !entrada || !Number.isFinite(valor)) return null;
  const texto = (c) => (col[c] === undefined ? null : String(r[col[c]] ?? '').trim().slice(0, 300) || null);
  return [
    patente,
    entrada,
    col.salida === undefined ? null : normalizarFechaHora(r[col.salida]),
    texto('imei'),
    texto('tipoAutopista'),
    texto('autopista'),
    texto('portico') || '',
    texto('tipoTarifa'),
    valor,
  ];
}

/**
 * Lee todas las pasadas de las filas de la hoja (arreglos). Repetidas dentro del
 * mismo archivo se cuentan una vez.
 * @returns { pasadas, descartadas, desde, hasta } o { error }
 */
export function leerPasadas(filas) {
  const enc = leerEncabezado(filas);
  if (enc.error) return enc;
  const pasadas = [];
  const vistas = new Set();
  let descartadas = 0, desde = null, hasta = null;
  for (let i = enc.fila + 1; i < filas.length; i++) {
    const p = normalizarFila(filas[i] || [], enc.col);
    if (!p) { if ((filas[i] || []).some((c) => c !== '' && c != null)) descartadas++; continue; }
    const clave = `${p[0]}|${p[1]}|${p[6]}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    pasadas.push(p);
    if (!desde || p[1] < desde) desde = p[1];
    if (!hasta || p[1] > hasta) hasta = p[1];
  }
  return { pasadas, descartadas, desde, hasta };
}

export const LOTE_MAXIMO = 5000;

/** Valida un lote que llega al servidor. @returns { filas } o { error } */
export function validarLote(lote) {
  if (!Array.isArray(lote) || lote.length === 0) return { error: 'lote' };
  if (lote.length > LOTE_MAXIMO) return { error: 'lote' };
  const filas = [];
  for (const p of lote) {
    if (!Array.isArray(p) || p.length !== CAMPOS.length) return { error: 'lote' };
    const [patente, entrada, salida, imei, tipoAutopista, autopista, portico, tipoTarifa, valor] = p;
    if (!/^[A-Z0-9]{4,8}$/.test(patente)) return { error: 'lote' };
    if (normalizarFechaHora(entrada) !== entrada) return { error: 'lote' };
    if (salida !== null && normalizarFechaHora(salida) !== salida) return { error: 'lote' };
    if (!Number.isInteger(valor) || valor < 0 || valor > 1_000_000) return { error: 'lote' };
    const textos = [imei, tipoAutopista, autopista, portico, tipoTarifa];
    if (textos.some((t) => t !== null && (typeof t !== 'string' || t.length > 300))) return { error: 'lote' };
    filas.push({
      patente, entrada, salida, imei, tipo_autopista: tipoAutopista, autopista,
      portico: portico ?? '', tipo_tarifa: tipoTarifa, valor,
    });
  }
  return { filas };
}
