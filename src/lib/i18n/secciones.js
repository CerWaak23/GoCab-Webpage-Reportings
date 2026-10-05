/**
 * Qué secciones nuevas ve cada rol en el dashboard. Hoy el rol es el texto de
 * src/lib/users.js; con el login de Google (U2) pasa a la tabla de usuarios.
 * Mostrar una tarjeta no reemplaza la validación de rol en cada ruta.
 */
const esTaller = (rol) => /taller/i.test(rol || '');

const REGLAS = {
  historial: () => true,
  talleres: () => true,
  carga: (rol) => !esTaller(rol),
};

export function puedeVerSeccion(rol, seccion) {
  const regla = REGLAS[seccion];
  return regla ? regla(rol) : false;
}
