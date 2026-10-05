import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase con la clave secreta. Solo se usa en rutas y acciones
 * del servidor: `server-only` hace fallar el build si algún componente del
 * navegador lo importa. Esta clave salta las reglas de acceso (RLS), así que
 * cada ruta valida el rol del usuario antes de consultar.
 */
let cliente = null;

export function supabaseServidor() {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error('Falta SUPABASE_URL');
  if (!clave) throw new Error('Falta SUPABASE_SECRET_KEY');
  if (clave.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SECRET_KEY tiene una clave publicable; debe ser la secreta (sb_secret_...)');
  }
  if (!cliente) {
    cliente = createClient(url, clave, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}
