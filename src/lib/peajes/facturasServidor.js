import 'server-only';
import { supabaseServidor } from '@/lib/supabase/server';

async function todas(consulta) {
  const salida = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999);
    if (error) throw new Error('No se pudo leer la base');
    salida.push(...data);
    if (data.length < 1000) return salida;
  }
}

export async function subirCorrida({ corrida, cruce, facturas, ajustes, autor }) {
  const { data, error } = await supabaseServidor().rpc('subir_corrida_peajes', {
    p_corrida: corrida, p_cruce: cruce, p_facturas: facturas, p_ajustes: ajustes, p_usuario: autor,
  });
  if (error) throw new Error('No se pudo guardar la corrida');
  return data;
}

/**
 * La última corrida con su cruce y facturas, los ajustes por confirmar o de esa
 * corrida, y lo ya aplicado por conductor.
 */
export async function leerFacturas() {
  const sb = supabaseServidor();
  const { data: corrida, error } = await sb.from('peajes_corridas').select('*').order('fecha', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('No se pudo leer la base');
  if (!corrida) return { corrida: null, cruce: [], facturas: [], ajustes: [], aplicado: {} };

  const columnasAjuste = 'id, fecha_corrida, conductor, patentes, desde, hasta, dias, accion, monto_propuesto, rebajar_deuda, devolver_plata, estado, monto_aplicado, fecha_aplicado, referencia, nota, marcado_por, marcado_en';
  const [cruce, facturas, abiertos, aplicados] = await Promise.all([
    todas(() => sb.from('peajes_cruce').select('*').eq('corrida', corrida.fecha).order('nombre')),
    todas(() => sb.from('peajes_facturas').select('*').eq('corrida', corrida.fecha).order('emisor').order('desde')),
    todas(() => sb.from('peajes_ajustes').select(columnasAjuste)
      .or(`estado.in.(PROPUESTO,"NO APLICADO"),marcado_en.not.is.null,fecha_corrida.eq.${corrida.fecha}`).order('id')),
    todas(() => sb.from('peajes_ajustes').select('conductor, monto_aplicado').eq('estado', 'APLICADO').order('id')),
  ]);
  const aplicado = {};
  for (const a of aplicados) aplicado[a.conductor] = (aplicado[a.conductor] || 0) + (a.monto_aplicado || 0);
  return { corrida, cruce, facturas, ajustes: abiertos, aplicado };
}

/**
 * Marca un ajuste: APLICADO (con el monto y la referencia), NO APLICADO, o lo
 * vuelve a PROPUESTO si se marcó por error. Solo se tocan los que siguen
 * abiertos o se marcaron en GoBills: lo REEMPLAZADO o ANULADO por el proceso no.
 */
export async function marcarAjuste({ id, estado, monto, referencia, autor }) {
  const sb = supabaseServidor();
  const { data: actual, error } = await sb.from('peajes_ajustes').select('estado, monto_propuesto, marcado_en').eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo leer la base');
  if (!actual) return { error: 'no_existe' };
  const abierto = actual.estado === 'PROPUESTO' || (actual.marcado_en && ['APLICADO', 'NO APLICADO'].includes(actual.estado));
  if (!abierto) return { error: 'cerrado' };

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const cambios = estado === 'APLICADO'
    ? { estado, monto_aplicado: monto ?? actual.monto_propuesto, fecha_aplicado: hoy, referencia: referencia || null, marcado_por: autor, marcado_en: new Date().toISOString() }
    : estado === 'NO APLICADO'
      ? { estado, monto_aplicado: null, fecha_aplicado: null, referencia: null, marcado_por: autor, marcado_en: new Date().toISOString() }
      : { estado: 'PROPUESTO', monto_aplicado: null, fecha_aplicado: null, referencia: null, marcado_por: null, marcado_en: null };
  const { error: e2 } = await sb.from('peajes_ajustes').update(cambios).eq('id', id);
  if (e2) throw new Error('No se pudo guardar');
  return { ok: true };
}
