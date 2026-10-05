'use client';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente del navegador. Solo sirve para iniciar sesión con Google: con la
 * clave publicable y RLS activo sin políticas, no puede leer ni escribir datos.
 * Todos los datos pasan por las rutas del servidor (lib/supabase/server.js).
 */
export function supabaseNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
