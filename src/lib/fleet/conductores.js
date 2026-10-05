import { formatearRut, rutValido } from '@/lib/rut';
import { leerPatentes } from '@/lib/patente';
import { normalizarNombre, limpiarNombre } from './nombres';

const texto = (v) => String(v ?? '').trim();
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
    cedulasPorVencer: conductores.filter((c) => c.venceCedula && dias(hoy, c.venceCedula) <= 60).length,
  };
}
