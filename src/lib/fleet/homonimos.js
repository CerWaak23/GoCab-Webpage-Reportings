import 'server-only';
import { normalizarNombre } from './nombres';

/**
 * Homónimos: un despedido y un conductor activo con el mismo nombre pero otro
 * RUT (o el activo sin RUT) son dos personas. Hubo dos MATIAS FIGUEROA: uno
 * despedido el 20-08 con el VZSS82 y otro que entró el 08-09 con el VZSS66.
 * Bills y multas vienen solo con el nombre, así que todo quedaba junto.
 *
 * Un cargo es del despedido si es de uno de los autos que manejó hasta el
 * despido; si no se conocen sus autos o el cargo no trae patente, si es de
 * hasta 3 días después del despido (los peajes llegan con atraso). Esos cargos
 * se renombran "NOMBRE (DESPEDIDO dd-mm)", y el reporte no une ese nombre con
 * el del activo.
 */
const DIAS_ATRASO = 3;
export const MARCA_DESPEDIDO = '(DESPEDIDO ';

const patenteDe = (vehiculo) => {
  const s = String(vehiculo || '');
  return (s.match(/\(([^)]+)\)\s*$/)?.[1] || s).toUpperCase().replace(/[^A-Z0-9]/g, '');
};
const masDias = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
// "2026-08-21 09:03:12" o "21/08/2026" → "2026-08-21"
const isoDe = (texto) => {
  const s = String(texto || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

/** Devuelve (nombre, vehiculo, fecha) → nombre a usar. Sin homónimos, el mismo nombre. */
export async function separadorHomonimos(sb) {
  const [desp, act] = await Promise.all([
    sb.from('despedidos').select('rut, nombre, nombre_fleet, despido'),
    sb.from('conductores').select('rut, nombre, nombre_fleet').is('baja', null),
  ]);
  if (desp.error || act.error) return (nombre) => nombre;

  const activos = new Map(); // nombre → RUTs de activos con ese nombre
  for (const c of act.data || []) {
    for (const n of [c.nombre, c.nombre_fleet].filter(Boolean).map(normalizarNombre)) {
      if (!activos.has(n)) activos.set(n, []);
      activos.get(n).push(c.rut || null);
    }
  }
  const porNombre = new Map(); // nombre → despedidos con homónimo activo
  for (const d of desp.data || []) {
    if (!d.despido) continue;
    const nombres = [...new Set([d.nombre, d.nombre_fleet].filter(Boolean).map(normalizarNombre))];
    if (!nombres.some((n) => (activos.get(n) || []).some((rut) => !rut || rut !== d.rut))) continue;
    for (const n of nombres) {
      if (!porNombre.has(n)) porNombre.set(n, []);
      porNombre.get(n).push({ ...d, autos: new Set() });
    }
  }
  if (!porNombre.size) return (nombre) => nombre;

  // Autos que manejó cada uno hasta el despido, según los exports de conductores
  const lista = [...porNombre.values()].flat();
  const ruts = [...new Set(lista.map((d) => d.rut).filter(Boolean))];
  if (ruts.length) {
    const { data } = await sb.from('conductores_balances').select('rut, patente, fecha').in('rut', ruts);
    for (const f of data || []) {
      for (const d of lista) {
        if (d.rut === f.rut && f.patente && String(f.fecha).slice(0, 10) <= d.despido) d.autos.add(patenteDe(f.patente));
      }
    }
  }

  return (nombre, vehiculo, fecha) => {
    const cands = porNombre.get(normalizarNombre(nombre));
    if (!cands) return nombre;
    const p = patenteDe(vehiculo);
    const f = isoDe(fecha);
    const d = cands.find((x) => (p && x.autos.size ? x.autos.has(p) : !!f && f <= masDias(x.despido, DIAS_ATRASO)));
    if (!d) return nombre;
    const [, mm, dd] = d.despido.split('-');
    return `${nombre} ${MARCA_DESPEDIDO}${dd}-${mm})`;
  };
}

/**
 * Aplica el separador a un reporte: cada cargo decide por su patente y fecha, y
 * sus pagos siguen al cargo por la referencia.
 */
export function separarEnReporte(lista, eventos, separar, { fecha }) {
  const porRef = new Map();
  const cargos = (lista || []).map((x) => {
    if (!x.driver) return x;
    const nombre = separar(x.driver, x.vehicle, fecha(x));
    if (nombre === x.driver) return x;
    if (x.reference) porRef.set(x.reference, nombre);
    return { ...x, driver: nombre };
  });
  const pagos = (eventos || []).map((e) => (porRef.has(e.reference) ? { ...e, driver: porRef.get(e.reference) } : e));
  return { cargos, pagos };
}
