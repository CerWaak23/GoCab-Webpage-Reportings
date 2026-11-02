/**
 * Lee los dos Excel del proceso semanal de conciliación de peajes (Conciliacion
 * Peajes/_sistema/src/semanal.py) para subirlos a GoBills:
 *   - "Cruce Peajes por Conductor - Semana <fecha>.xlsx": qué se cruzó contra
 *     facturas de cada conductor y qué facturas entraron.
 *   - "Libro_ajustes_peajes.xlsx": cada ajuste propuesto y si se aplicó.
 * Se usa en el navegador (los archivos se leen ahí) y sus validaciones en el
 * servidor.
 */

const pad = (n) => String(n).padStart(2, '0');

/** Serial de Excel, "2026-10-21", "21-10-2026" o Date → "2026-10-21". */
export function fechaISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400) * 1000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
}

const entero = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : Math.round(n);
};
const texto = (v, max = 4000) => (v === null || v === undefined || v === '' ? null : String(v).trim().slice(0, max) || null);

/** Hoja como objetos por título (filas = arreglos, la primera son los títulos). */
function objetos(filas) {
  const [titulos = [], ...resto] = filas || [];
  return resto.filter((r) => r.some((c) => c !== '' && c != null))
    .map((r) => Object.fromEntries(titulos.map((t, i) => [String(t ?? '').trim(), r[i]])));
}

/** Qué es el archivo, por sus hojas. */
export function tipoDeArchivo(hojas) {
  if (hojas.Conductores && hojas['Facturas incluidas']) return 'cruce';
  if (hojas.Ajustes) return 'libro';
  return null;
}

function conductor(r, activo) {
  return {
    nombre: texto(r.Nombre, 200),
    rut: /^\d/.test(String(r.RUT ?? '')) ? texto(r.RUT, 20) : null,
    patentes: texto(r['Patente(s)'], 200),
    desde: fechaISO(r['Fecha inicio cruce']),
    hasta: fechaISO(r['Fecha fin cruce']),
    dias: entero(r.Dias),
    facturado: entero(r['Monto facturas']) ?? 0,
    cobrado: entero(r['Monto cobrado']) ?? 0,
    pagado: entero(r['Monto pagado']) ?? 0,
    accion: texto(r.ACCION, 40),
    cobrar: entero(r.Cobrar) ?? 0,
    rebajar: entero(r['Rebajar deuda']) ?? 0,
    devolver: entero(r['Devolver (plata)']) ?? 0,
    estado: texto(r.Estado, 40),
    autopistas_comparadas: texto(r['Autopistas comparadas'], 1000),
    cobrado_sin_factura: entero(r['Cobrado en autopistas sin factura']) ?? 0,
    autopistas_sin_factura: texto(r['Autopistas sin factura'], 1000),
    motivo: texto(r.Motivo),
    activo,
  };
}

/**
 * @param hojas  { nombreHoja: filas como arreglos }
 * @returns { corrida, cruce, facturas } o { error }
 */
export function leerCruce(hojas, archivo = '') {
  const resumen = (hojas.Resumen || []).map((r) => r.filter((c) => c !== '' && c != null).join(' ')).filter(Boolean).join('\n');
  const m = resumen.match(/Corrida del (\d{2})-(\d{2})-(\d{4})/) || String(archivo).match(/Semana (\d{4})-(\d{2})-(\d{2})/);
  const fecha = !m ? null : m[0].startsWith('Corrida') ? `${m[3]}-${m[2]}-${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
  if (!fecha) return { error: 'fecha' };

  const cruce = [
    ...objetos(hojas.Conductores).map((r) => conductor(r, true)),
    ...objetos(hojas['Ya no estan (fuera de CF)']).map((r) => conductor(r, false)),
  ].filter((c) => c.nombre);

  const incluidas = objetos(hojas['Facturas incluidas']).map((r) => ({
    emisor: texto(r.Emisor, 100), cuenta: texto(r.Cuenta, 100), folio: texto(r.Folio, 100),
    desde: fechaISO(r['Periodo desde']), hasta: fechaISO(r['Periodo hasta']),
    pasadas: entero(r.Pasadas), monto: entero(r['Monto detalle']),
    grupo: texto(r['Autos que cubre (grupo de flota)'], 200), incluida: true, motivo: null,
  }));
  const noIncluidas = objetos(hojas['Facturas NO incluidas']).map((r) => {
    const p = String(r.Periodo ?? '').split(/\s+a\s+/);
    return {
      emisor: texto(r.Concesionaria, 100), cuenta: null, folio: texto(r.Folio, 100),
      desde: fechaISO(p[0]), hasta: fechaISO(p[1]), pasadas: null, monto: entero(r.Monto),
      grupo: null, incluida: false, motivo: texto(r.Motivo, 1000),
    };
  });
  const facturas = [...incluidas, ...noIncluidas].filter((f) => f.emisor);
  const facturasHasta = incluidas.reduce((x, f) => (f.hasta && f.hasta > x ? f.hasta : x), '') || null;

  return { corrida: { fecha, archivo: texto(archivo, 200), resumen: texto(resumen, 4000), facturasHasta }, cruce, facturas };
}

/** El libro de ajustes, hoja "Ajustes". */
export function leerLibro(hojas) {
  const ajustes = objetos(hojas.Ajustes).map((r) => ({
    id: entero(r.id),
    fecha_corrida: fechaISO(r.fecha_corrida),
    conductor: texto(r.conductor, 200),
    rut: texto(r.rut, 20),
    patentes: texto(r.patentes, 200),
    desde: fechaISO(r.desde),
    hasta: fechaISO(r.hasta),
    dias: entero(r.dias),
    accion: texto(r.accion, 40),
    monto_propuesto: entero(r.monto_propuesto),
    rebajar_deuda: entero(r.rebajar_deuda),
    devolver_plata: entero(r.devolver_plata),
    estado: texto(r.estado, 200) || 'PROPUESTO',
    monto_aplicado: entero(r.monto_aplicado),
    fecha_aplicado: fechaISO(r.fecha_aplicado),
    referencia: texto(r.referencia_gobillslat, 200),
    nota: texto(r.nota),
  })).filter((a) => a.id && a.conductor);
  const ids = new Set(ajustes.map((a) => a.id));
  if (ids.size !== ajustes.length) return { error: 'libro' };
  return { ajustes };
}

/** Valida lo que llega al servidor antes de mandarlo a la base. */
export function validarSubida({ corrida, cruce, facturas, ajustes }) {
  if (!corrida || !fechaISO(corrida.fecha) || fechaISO(corrida.fecha) !== corrida.fecha) return 'corrida';
  if (!Array.isArray(cruce) || !cruce.length || cruce.length > 2000) return 'cruce';
  if (!Array.isArray(facturas) || facturas.length > 1000) return 'facturas';
  if (!Array.isArray(ajustes) || ajustes.length > 50000) return 'libro';
  if (cruce.some((c) => !c || typeof c.nombre !== 'string')) return 'cruce';
  if (ajustes.some((a) => !a || !Number.isInteger(a.id) || typeof a.conductor !== 'string')) return 'libro';
  return null;
}

export const ESTADOS_MARCA = ['APLICADO', 'NO APLICADO', 'PROPUESTO'];
