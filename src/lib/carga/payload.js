import { normalizarNombre } from '@/lib/fleet/nombres';

/** Orden en que se aplican varias cargas juntas: conductores antes que autos. */
export const ORDEN_TIPOS = ['drivers', 'vehicles', 'bills', 'fines'];

export function ordenarParaAplicar(cargas) {
  return [...cargas].sort((a, b) => ORDEN_TIPOS.indexOf(a.tipo) - ORDEN_TIPOS.indexOf(b.tipo));
}

/**
 * Filas que recibe la función aplicar_carga de la base (migraciones 0002 y 0003).
 * Solo vehicles y drivers escriben en tablas; bills y fines solo se registran.
 *
 * @param conductorDe  (auto) → id del conductor ya identificado en la base, o
 *                     null para que la base lo busque por nombre.
 */
export function payloadPara(analisis, conductorDe = () => null) {
  if (analisis.tipo === 'vehicles') {
    return analisis.datos.map((a) => ({
      patente: a.patente,
      vin: a.vin,
      marca: a.marca,
      modelo: a.modelo,
      anio: a.anio,
      color: a.color,
      estado: a.estado,
      grupo: a.grupo,
      creado: a.creado,
      modalidad: a.modalidad,
      conductor: a.conductor,
      clave: a.conductor ? normalizarNombre(a.conductor) : null,
      conductorId: a.conductor ? conductorDe(a) : null,
    }));
  }
  if (analisis.tipo === 'drivers') {
    return analisis.datos.map((c) => ({
      nombre: c.nombre,
      clave: c.clave,
      rut: c.rut,
      rutCrudo: c.rutCrudo,
      rutValido: c.rutValido,
      telefono: c.telefono,
      licencia: c.licencia,
      venceCedula: c.venceCedula,
      activacion: c.activacion,
      baja: c.baja,
      grupo: c.grupo,
      patentes: c.patentes,
    }));
  }
  return [];
}

/** Fecha de hoy en Chile, 'YYYY-MM-DD'. */
export function hoyEnChile(fecha = new Date()) {
  return fecha.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}
