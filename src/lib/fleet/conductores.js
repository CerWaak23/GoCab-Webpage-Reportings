import { formatearRut, rutValido } from '@/lib/rut';
import { leerPatentes } from '@/lib/patente';
import { normalizarNombre, limpiarNombre } from './nombres';

const texto = (v) => String(v ?? '').trim();
/**
 * "Bail paid" (garantía pagada) del export de conductores: con monto es renta,
 * en 0 es drive to own. Sin la columna (exports antiguos) no se sabe.
 */
export function leerGarantia(fila) {
  if (!fila || !('Bail paid' in fila)) return { garantia: null, modalidad: null };
  let crudo = texto(fila['Bail paid']).replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(crudo)) crudo = crudo.replace(/\./g, '');
  crudo = crudo.replace(',', '.');
  if (!crudo) return { garantia: null, modalidad: null };
  const monto = Number(crudo);
  if (!Number.isFinite(monto)) return { garantia: null, modalidad: null };
  return { garantia: Math.round(monto), modalidad: monto > 0 ? 'renta' : 'drive_to_own' };
}

const fecha = (v) => (/^\d{4}-\d{2}-\d{2}/.test(texto(v)) ? texto(v).slice(0, 10) : null);

/** Filas del export "drivers" de Fleet → conductores normalizados. */
export function leerConductores(filas) {
  const conductores = (filas || [])
    .filter((r) => texto(r['Name']))
    .map((r) => {
      const valido = rutValido(r['ID Number']);
      return {
        nombre: limpiarNombre(r['Name']),
        clave: normalizarNombre(r['Name']),
        rut: valido ? formatearRut(r['ID Number']) : null,
        rutCrudo: texto(r['ID Number']) || null,
        rutValido: valido,
        telefono: texto(r['Phone Number']) || null,
        licencia: texto(r['License Number']) || null,
        venceCedula: fecha(r['ID Expiry Date']),
        activacion: fecha(r['Activation Date']),
        baja: fecha(r['Fire Date']),
        patentes: leerPatentes(r['Vehicles']),
        grupo: texto(r['Manager Groups']) || null,
        ...leerGarantia(r),
      };
    });
  return { conductores, invalidos: conductores.filter((c) => !c.rutValido).map((c) => c.nombre) };
}

const repetidos = (xs) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
const dias = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000);

/** base.conductores: [{ nombre }] */
export function resumenConductores(leidos, base, hoy) {
  const { conductores, invalidos } = leidos;
  const conocidos = new Set((base?.conductores || []).map((c) => normalizarNombre(c.nombre)));
  return {
    total: conductores.length,
    bajas: conductores.filter((c) => c.baja).length,
    nuevos: conductores.filter((c) => !conocidos.has(c.clave)).length,
    rutInvalidos: invalidos,
    rutRepetidos: repetidos(conductores.filter((c) => c.rut).map((c) => c.rut)).length,
    homonimos: repetidos(conductores.map((c) => c.clave)).length,
    renta: conductores.filter((c) => c.modalidad === 'renta').length,
    driveToOwn: conductores.filter((c) => c.modalidad === 'drive_to_own').length,
    cedulasPorVencer: conductores.filter((c) => c.venceCedula && dias(hoy, c.venceCedula) <= 60).length,
  };
}
