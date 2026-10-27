import { puedeVerSeccion } from '@/lib/i18n/secciones';

/**
 * Quién puede hacer qué en Carga de datos: todo el que ve la sección puede
 * subir, revisar y aplicar (oct-2026: lo pidió el usuario, para que la carga
 * diaria no dependa de gerencia). Cada carga queda con el correo de quien la hizo.
 *
 * @returns null si puede; 401 o 403 si no.
 */
export function permisoCarga(usuario, accion) {
  if (!usuario) return 401;
  if (!puedeVerSeccion(usuario.role, 'carga')) return 403;
  return null;
}

/**
 * Corregir la maestra (y copiarla a mano a la hoja) es solo de gerencia
 * (27-oct-2026): una corrección le gana a Fleet hasta que alguien la quite, y
 * de esa hoja leen el reporte, Copec e inDrive.
 */
export function permisoMaestra(usuario) {
  if (!usuario) return 401;
  return usuario.isManager ? null : 403;
}

const EXTENSIONES = ['xlsx', 'xls', 'csv'];
export const TAMANO_MAXIMO = 10 * 1024 * 1024;

/** Valida el archivo antes de pedir la URL de subida. */
export function validarArchivo(nombre, tamano) {
  const ext = String(nombre || '').split('.').pop().toLowerCase();
  if (!EXTENSIONES.includes(ext)) return { error: 'extension' };
  if (!(tamano > 0) || tamano > TAMANO_MAXIMO) return { error: 'tamano' };
  return { ext };
}
