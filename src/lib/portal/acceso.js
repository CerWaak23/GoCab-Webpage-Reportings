import 'server-only';
import { supabaseServidor } from '@/lib/supabase/server';
import { normalizarPatente } from '@/lib/patente';
import { formatearRut } from '@/lib/rut';
import { hoyEnChile } from '@/lib/carga/payload';

/**
 * Acceso del portal de conductores contra la base (KTD3). Entra con patente +
 * RUT si Fleet le asigna ese auto hoy, o se lo asignó hasta hace 30 días
 * (R76: puede ver sus actas, pero no subir fotos de un auto que ya devolvió).
 * Cada ruta vuelve a revisar en la base: el token solo dice quién es.
 */
export const DIAS_DESPUES_DE_DEVOLVER = 30;

const restarDias = (fecha, dias) => new Date(Date.parse(fecha) - dias * 86400000).toISOString().slice(0, 10);

async function asignacion(conductorId, patente) {
  const { data, error } = await supabaseServidor().from('asignaciones')
    .select('id, patente, desde, hasta').eq('patente', patente).eq('conductor_id', conductorId)
    .order('desde', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const a = data[0];
  if (!a) return null;
  if (a.hasta && a.hasta < restarDias(hoyEnChile(), DIAS_DESPUES_DE_DEVOLVER)) return null;
  return { asignacionId: a.id, patente: a.patente, desde: a.desde, vigente: !a.hasta };
}

/** Login: { conductorId, nombre, patente, vigente } o null. Sin pistas de qué falló. */
export async function buscarEnBase(patenteEscrita, rutEscrito) {
  const patente = normalizarPatente(patenteEscrita);
  const rut = formatearRut(rutEscrito);
  if (!patente || !rut) return null;
  const { data: c, error } = await supabaseServidor().from('conductores')
    .select('id, nombre').eq('rut', rut).maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) return null;
  const a = await asignacion(c.id, patente);
  return a && { conductorId: c.id, nombre: c.nombre, patente, vigente: a.vigente };
}

/** Lo que el conductor de la sesión puede hacer con su auto ahora. */
export async function autoDeLaSesion(sesion) {
  if (!sesion?.conductorId || !sesion?.patente) return null;
  return asignacion(sesion.conductorId, sesion.patente);
}
