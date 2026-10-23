import 'server-only';
import { gzipSync, gunzipSync } from 'node:zlib';
import { supabaseServidor } from '@/lib/supabase/server';

/**
 * Caché de los reportes en Supabase Storage (bucket privado `cache`, migración
 * 0019), comprimido. Es solo para ir rápido: si no se puede leer o escribir, el
 * reporte se calcula entero y nada se rompe.
 */
const BUCKET = 'cache';

/**
 * Versión del código que calculó lo guardado. Cada despliegue la cambia, así
 * que un cambio en cómo se calcula un reporte no sigue sirviendo el resultado
 * viejo: se recalcula solo la primera vez.
 */
export const CODIGO = process.env.VERCEL_GIT_COMMIT_SHA || 'local';

export async function leerCache(nombre) {
  try {
    const { data, error } = await supabaseServidor().storage.from(BUCKET).download(`${nombre}.json.gz`);
    if (error || !data) return null;
    return JSON.parse(gunzipSync(Buffer.from(await data.arrayBuffer())).toString('utf8'));
  } catch {
    return null;
  }
}

export async function guardarCache(nombre, datos) {
  try {
    const cuerpo = gzipSync(Buffer.from(JSON.stringify(datos), 'utf8'));
    const { error } = await supabaseServidor().storage.from(BUCKET)
        .upload(`${nombre}.json.gz`, cuerpo, { upsert: true, contentType: 'application/gzip' });
    if (error) console.error(`[cache] no se pudo guardar ${nombre}:`, error.message);
  } catch (e) {
    console.error(`[cache] no se pudo guardar ${nombre}:`, e.message);
  }
}

/** Día en Chile de una fecha, 'YYYY-MM-DD'. */
export const diaChile = (fecha) => new Date(fecha).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

/** Inicio de un día de Chile como instante ISO (00:00 en Santiago). */
export function inicioDiaChile(dia) {
  // Santiago está entre UTC-3 y UTC-4: se prueba cuál de las dos cae en ese día
  for (const h of [3, 4]) {
    const iso = new Date(`${dia}T0${h}:00:00Z`).toISOString();
    if (diaChile(iso) === dia && diaChile(new Date(Date.parse(iso) - 1)) !== dia) return iso;
  }
  return new Date(`${dia}T04:00:00Z`).toISOString();
}
