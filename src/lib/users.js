/**
 * Usuarios del portal interno. La lista vive en la tabla `usuarios` de Supabase
 * (ver src/lib/usuarios.js): para agregar a alguien, cambiarle el rol o sacarlo,
 * se edita esa tabla. Ya no hay que tocar este archivo ni desplegar.
 *
 * Gerentes (rol gerencia o admin) ven el Reporte Financiero.
 */
import { buscarUsuario } from './usuarios';

/** Rol de gerente por el texto del cargo: lo siguen usando partes viejas del código. */
export function isManager(role) {
  if (!role) return false;
  return role.toLowerCase().includes('gerente') || role.toLowerCase().includes('gerencia');
}

/**
 * Usuario activo con ese correo, o null. Si la base no responde lanza un error:
 * mejor un login que falla que uno que deja entrar a alguien dado de baja.
 */
export async function getUserByEmail(email) {
  const r = await buscarUsuario(email);
  if (!r.ok) throw new Error('No se pudo consultar la lista de usuarios');
  return r.usuario;
}

export async function isRegisteredUser(email) {
  return !!(await getUserByEmail(email));
}
