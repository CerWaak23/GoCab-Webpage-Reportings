/**
 * Qué puede ver cada rol en el Historial. Las cédulas, firmas, actas y
 * documentos de siniestro son datos personales del conductor: el encargado de
 * taller no los ve, y cada vez que alguien los abre queda registrado (R63).
 */
export const CLASES_SENSIBLES = ['cedula', 'firma', 'acta', 'siniestro_doc'];

const esTaller = (rol) => /taller/i.test(rol || '');

/** @returns null si puede; 401 o 403 si no. */
export function puedeVerArchivo(usuario, clase) {
  if (!usuario) return 401;
  if (CLASES_SENSIBLES.includes(clase) && esTaller(usuario.role)) return 403;
  return null;
}

export const registraAcceso = (clase) => CLASES_SENSIBLES.includes(clase);

/** El taller ve el nombre del conductor, no su RUT ni su teléfono. */
export const veContactoConductor = (usuario) => !!usuario && !esTaller(usuario.role);
