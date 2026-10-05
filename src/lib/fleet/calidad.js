import { normalizarPatente, leerPatentes } from '@/lib/patente';
import { rutValido, formatearRut } from '@/lib/rut';
import { normalizarNombre } from './nombres';
import { crearIndice, buscarConductor, normalizarTelefono } from './identidad';

/**
 * Revisión de calidad de un export antes de aplicarlo. Cualquiera de los
 * cuatro archivos puede venir con errores, así que se cuentan por tipo y se
 * informa cómo se identificó a cada conductor. No corrige nada: Fleet manda,
 * y los errores se arreglan allá.
 *
 * base: { conductores: [{ id, nombre, telefono, patentes }], patentes: [..] }
 */

// Patentes chilenas: BBBB12 (desde 2008) o AA1234 (antiguas).
const PATENTE_CHILE = /^([A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/;
const texto = (v) => String(v ?? '').trim();
const esMonto = (v) => texto(v) === '' || Number.isFinite(Number(texto(v).replace(/[^\d.-]/g, '') || 'x'));
const patenteEnParentesis = (v) => normalizarPatente((/\(([A-Za-z0-9 -]+)\)\s*$/.exec(texto(v)) || [])[1]);

const repetidos = (xs) => {
  const vistos = new Set();
  const rep = new Set();
  for (const x of xs) if (x) (vistos.has(x) ? rep : vistos).add(x);
  return rep;
};

/**
 * Problemas que hacen dudar del archivo entero. Un conductor con dos autos no
 * es uno de ellos: puede tener un auto de reemplazo.
 */
export const GRAVES = ['patente_invalida', 'patente_repetida', 'rut_repetido'];

export function revisarCalidad(tipo, filas, base = {}) {
  const lista = filas || [];
  const problemas = {};
  const marcar = (clave, n = 1) => { if (n > 0) problemas[clave] = (problemas[clave] || 0) + n; };
  const cruce = { telefono: 0, nombre: 0, orden: 0, parcial: 0, ambiguo: 0, sin: 0 };
  const noEncontrados = new Set();
  const indice = crearIndice(base.conductores);
  const patentes = new Set((base.patentes || []).map(normalizarPatente));

  const identificar = (ref) => {
    if (!normalizarNombre(ref.nombre) || indice.length === 0) return null;
    const r = buscarConductor(ref, indice);
    if (!r) { cruce.sin++; noEncontrados.add(normalizarNombre(ref.nombre)); return null; }
    if (r.ambiguo) { cruce.ambiguo++; noEncontrados.add(normalizarNombre(ref.nombre)); return null; }
    cruce[r.por]++;
    return r.id;
  };

  if (tipo === 'vehicles') {
    const ps = lista.map((r) => normalizarPatente(r['Plate Number']));
    marcar('patente_vacia', ps.filter((p) => !p).length);
    marcar('patente_invalida', ps.filter((p) => p && !PATENTE_CHILE.test(p)).length);
    marcar('patente_repetida', repetidos(ps).size);
    const ids = lista.map((r) => identificar({ nombre: r['Driver'], patente: r['Plate Number'] }));
    // Al entrar a taller Fleet le quita el conductor al auto, así que un
    // conductor con dos autos en el archivo tiene un reemplazo sin que el otro
    // esté en taller. Con la base se compara la persona identificada (dos
    // homónimos con un auto cada uno no cuentan); sin base, solo el nombre.
    marcar('conductor_repetido', indice.length
      ? repetidos(ids).size
      : repetidos(lista.map((r) => normalizarNombre(r['Driver']))).size);
  }

  if (tipo === 'drivers') {
    marcar('rut_invalido', lista.filter((r) => !rutValido(r['ID Number'])).length);
    marcar('rut_repetido', repetidos(lista.filter((r) => rutValido(r['ID Number'])).map((r) => formatearRut(r['ID Number']))).size);
    marcar('telefono_repetido', repetidos(lista.map((r) => normalizarTelefono(r['Phone Number']))).size);
    marcar('sin_telefono', lista.filter((r) => !normalizarTelefono(r['Phone Number'])).length);
    const pats = lista.flatMap((r) => leerPatentes(r['Vehicles']));
    marcar('patente_compartida', repetidos(pats).size);
    if (patentes.size) marcar('patente_no_existe', pats.filter((p) => p && !patentes.has(p)).length);
  }

  if (tipo === 'bills') {
    marcar('monto_invalido', lista.filter((r) => !esMonto(r['Amount']) || !esMonto(r['Paid Amount'])).length);
    if (patentes.size) marcar('patente_no_existe', lista.filter((r) => { const p = patenteEnParentesis(r['Vehicle']); return p && !patentes.has(p); }).length);
    for (const r of lista) identificar({ nombre: r['Driver'], telefono: r['Phone Number'], patente: patenteEnParentesis(r['Vehicle']) });
  }

  if (tipo === 'fines') {
    marcar('monto_invalido', lista.filter((r) => !esMonto(r['Amount to pay']) || !esMonto(r['Remaining Amount'])).length);
    if (patentes.size) marcar('patente_no_existe', lista.filter((r) => { const p = normalizarPatente(r['Vehicle Number']); return p && !patentes.has(p); }).length);
    // "Driver" trae el nombre completo; "Driver Name" a veces solo nombre y apellido.
    for (const r of lista) identificar({ nombre: texto(r['Driver']) || r['Driver Name'], patente: r['Vehicle Number'] });
  }

  const graves = GRAVES.reduce((a, k) => a + (problemas[k] || 0), 0);
  return {
    problemas,
    graves,
    cruce: indice.length ? cruce : null,
    noEncontrados: [...noEncontrados].sort().slice(0, 50),
    totalNoEncontrados: noEncontrados.size,
  };
}
