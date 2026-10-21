/**
 * Qué secciones nuevas ve cada rol en el dashboard. Hoy el rol es el texto de
 * src/lib/users.js; con el login de Google (U2) pasa a la tabla de usuarios.
 * Mostrar una tarjeta no reemplaza la validación de rol en cada ruta.
 */
import { SECCIONES_PAUSADAS } from '@/lib/pausado';

const esTaller = (rol) => /taller/i.test(rol || '');

const REGLAS = {
  historial: () => true,
  talleres: () => true,
  registros: () => true,
  carga: (rol) => !esTaller(rol),
  // Coordinadores y gerentes: los de taller no ven la plata de los despedidos
  despedidos: (rol) => !esTaller(rol),
};

export function puedeVerSeccion(rol, seccion) {
  if (SECCIONES_PAUSADAS.includes(seccion)) return false;
  const regla = REGLAS[seccion];
  return regla ? regla(rol) : false;
}
