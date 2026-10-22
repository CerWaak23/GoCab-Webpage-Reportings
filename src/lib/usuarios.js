/**
 * Usuarios del portal interno: la tabla `usuarios` de Supabase es la lista
 * maestra. Se agregan, cambian de rol o se desactivan ahí, sin desplegar.
 *
 *   rol     gerencia | coordinador | taller | admin   → permisos
 *   cargo   "Gerente de Operaciones", "Coordinadora de Flota"… → lo que se muestra
 *   activo  false saca al usuario del portal en el siguiente clic, aunque tenga
 *           una sesión abierta
 *
 * Usa fetch contra la API REST y no el cliente de Supabase porque también corre
 * en el middleware, que va en el runtime Edge.
 */

const TTL_MS = 60 * 1000; // cuánto se recuerda una consulta: un desactivado sale en menos de un minuto
const cache = new Map(); // email → { hasta, resultado }

export const CARGO_POR_ROL = {
  gerencia: 'Gerencia',
  coordinador: 'Coordinador de Flota',
  taller: 'Taller',
  admin: 'Administrador',
};

/** Fila de la tabla → el usuario que usa la sesión. Gerencia y admin son gerentes. */
export function usuarioDesdeFila(f) {
  if (!f) return null;
  let role = String(f.cargo || '').trim() || CARGO_POR_ROL[f.rol] || 'Colaborador';
  // Los permisos de secciones miran si el rol dice "taller": un usuario de taller
  // con un cargo que no lo diga ("Mecánico") vería secciones que no le tocan.
  if (f.rol === 'taller' && !/taller/i.test(role)) role = `Taller · ${role}`;
  return {
    email: String(f.email).toLowerCase(),
    name: f.nombre,
    role,
    rol: f.rol,
    isManager: f.rol === 'gerencia' || f.rol === 'admin',
  };
}

/**
 * Busca un usuario activo por correo.
 * @returns { ok: true, usuario } — usuario es null si no existe o está inactivo
 *          { ok: false }          — no se pudo consultar la base
 */
export async function buscarUsuario(email) {
  const correo = String(email || '').trim().toLowerCase();
  if (!correo) return { ok: true, usuario: null };

  const guardado = cache.get(correo);
  if (guardado && guardado.hasta > Date.now()) return guardado.resultado;

  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) return { ok: false };
  try {
    const r = await fetch(
      `${url}/rest/v1/usuarios?select=*&email=eq.${encodeURIComponent(correo)}&limit=1`,
      { headers: { apikey: clave }, cache: 'no-store' },
    );
    if (!r.ok) return { ok: false };
    const [fila] = await r.json();
    const resultado = { ok: true, usuario: fila && fila.activo ? usuarioDesdeFila(fila) : null };
    cache.set(correo, { hasta: Date.now() + TTL_MS, resultado });
    return resultado;
  } catch {
    return { ok: false };
  }
}
