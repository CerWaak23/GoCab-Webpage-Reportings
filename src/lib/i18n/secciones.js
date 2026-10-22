/**
 * Qué secciones nuevas ve cada rol en el dashboard. Hoy el rol es el texto de
 * la tabla `usuarios` de Supabase (cargo, o el rol si no hay cargo; ver src/lib/usuarios.js).
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
