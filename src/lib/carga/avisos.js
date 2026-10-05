/**
 * Avisos antes de aplicar una carga. Los exports se suben varias veces al día
 * y a veces vienen mal (un filtro puesto en Fleet, un archivo viejo), así que
 * se avisa y se pide confirmar en vez de aplicar a ciegas.
 */

/** Número del export de Fleet en el nombre del archivo ("export-5841-vehicles.xlsx" → 5841). */
export function numeroExport(nombre) {
  const m = /export-(\d+)-/i.exec(String(nombre || ''));
  return m ? Number(m[1]) : null;
}

/** Bajo esta fracción de filas respecto a la última carga aplicada, se avisa. */
export const CAIDA_FILAS = 0.7;

/** Desde esta fracción de problemas graves (ver calidad.js) se duda del archivo. */
export const ERRORES_MAXIMOS = 0.05;

/**
 * @param carga   { tipo, filas, numero, sha256, graves }
 * @param previas cargas ya aplicadas del mismo tipo: [{ filas, numero_export, sha256, creado }]
 * @returns ['mismo_archivo' | 'export_antiguo' | 'filas_bajan' | 'muchos_errores']
 */
export function avisosCarga(carga, previas) {
  const avisos = [];
  if (carga.sha256 && previas.some((p) => p.sha256 === carga.sha256)) avisos.push('mismo_archivo');

  const numeros = previas.map((p) => p.numero_export).filter((n) => n != null);
  if (carga.numero != null && numeros.length && carga.numero < Math.max(...numeros)) avisos.push('export_antiguo');

  const ultima = [...previas].sort((a, b) => String(b.creado).localeCompare(String(a.creado)))[0];
  if (ultima?.filas && carga.filas < ultima.filas * CAIDA_FILAS) avisos.push('filas_bajan');
  if (carga.graves && carga.graves >= Math.max(2, carga.filas * ERRORES_MAXIMOS)) avisos.push('muchos_errores');
  return avisos;
}
