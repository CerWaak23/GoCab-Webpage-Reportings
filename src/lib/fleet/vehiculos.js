import { normalizarPatente } from '@/lib/patente';
import { normalizarNombre, limpiarNombre } from './nombres';

const texto = (v) => String(v ?? '').trim();

/**
 * Columna de modalidad (renta o drive to own). Fleet todavía no la exporta;
 * se acepta cualquiera de estos encabezados cuando la agregue.
 */
export const COLUMNAS_MODALIDAD = ['Contract Type', 'Rental Type', 'Ownership Type', 'Vehicle Type', 'Type', 'Tipo', 'Modalidad'];

export function leerModalidad(fila) {
  const col = COLUMNAS_MODALIDAD.find((c) => texto(fila?.[c]));
  if (!col) return null;
  const v = texto(fila[col]).toLowerCase();
  if (/drive|own|dto|propiedad/.test(v)) return 'drive_to_own';
  if (/rent|renta|arriendo|lease/.test(v)) return 'renta';
  return null;
}

/** Filas del export "vehicles" de Fleet → autos normalizados. */
export function leerVehiculos(filas) {
  return (filas || [])
    .map((r) => ({
      patente: normalizarPatente(r['Plate Number']),
      marca: texto(r['Brand']) || null,
      modelo: texto(r['Model']) || null,
      anio: Number.parseInt(r['Year'], 10) || null,
      vin: texto(r['Vin Code']) || null,
      color: texto(r['Color']) || null,
      estado: texto(r['Status']) || null,
      conductor: limpiarNombre(r['Driver']),
      grupo: texto(r['Manager Group']) || null,
      creado: texto(r['Created At']).slice(0, 10) || null,
      modalidad: leerModalidad(r),
    }))
    .filter((a) => a.patente);
}

export function resumenVehiculos(autos) {
  const porEstado = {};
  for (const a of autos) porEstado[a.estado || 'sin_estado'] = (porEstado[a.estado || 'sin_estado'] || 0) + 1;
  return {
    total: autos.length,
    porEstado,
    sinConductor: autos.filter((a) => !a.conductor).length,
    sinVin: autos.filter((a) => !a.vin).length,
    renta: autos.filter((a) => a.modalidad === 'renta').length,
    driveToOwn: autos.filter((a) => a.modalidad === 'drive_to_own').length,
  };
}

/**
 * Compara el export con la base. No escribe nada: manda Fleet, y esto solo
 * describe qué cambiaría y qué acta falta en GoBills.
 *
 * base.autos: [{ patente, conductor, ultimaActa?: { tipo: 'entrega'|'recepcion', conductor } }]
 */
export function diferenciasVehiculos(autos, base) {
  const enBase = new Map((base?.autos || []).map((a) => [normalizarPatente(a.patente), a]));
  const enArchivo = new Set(autos.map((a) => a.patente));
  const out = [];

  for (const a of autos) {
    const b = enBase.get(a.patente);
    if (!b) {
      out.push(!a.conductor && a.estado === 'available'
        ? { patente: a.patente, tipo: 'nuevo', sinFotosIngreso: true }
        : { patente: a.patente, tipo: 'nuevo', sinFotosIngreso: false });
      continue;
    }
    const antes = b.conductor ? normalizarNombre(b.conductor) : null;
    const ahora = a.conductor ? normalizarNombre(a.conductor) : null;
    if (antes === ahora) continue;

    const acta = b.ultimaActa;
    let faltaActa = null;
    if (ahora && !(acta?.tipo === 'entrega' && normalizarNombre(acta.conductor) === ahora)) faltaActa = 'entrega';
    if (!ahora && acta?.tipo !== 'recepcion') faltaActa = 'recepcion';
    out.push({ patente: a.patente, tipo: 'cambio_conductor', antes: b.conductor ?? null, ahora: a.conductor, faltaActa });
  }

  for (const [patente] of enBase) {
    if (!enArchivo.has(patente)) out.push({ patente, tipo: 'ausente' });
  }
  return out;
}
