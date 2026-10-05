import { puedeVerSeccion } from '@/lib/i18n/secciones';

/**
 * Quién puede hacer qué en Carga de datos. Subir y revisar: quien ve la
 * sección. Aplicar (escribe en la base): solo gerencia, hasta que el login
 * con Google traiga el rol "admin" (U2).
 *
 * @returns null si puede; 401 o 403 si no.
 */
export function permisoCarga(usuario, accion) {
  if (!usuario) return 401;
  if (!puedeVerSeccion(usuario.role, 'carga')) return 403;
  if (accion === 'aplicar' && !usuario.isManager) return 403;
  return null;
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
