import 'server-only';
import { supabaseServidor } from '@/lib/supabase/server';
import { leerMaestra } from '@/lib/maestra/servidor';
import { compararPeajes, COMPARAR_DESDE, sumarDias } from './comparar';

/** Lee todas las páginas de una consulta: PostgREST entrega de a 1000 filas. */
async function todas(consulta) {
  const salida = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999);
    if (error) throw new Error('No se pudo leer la base');
    salida.push(...data);
    if (data.length < 1000) return salida;
  }
}

export async function iniciarCarga({ archivo, filas, desde, hasta, autor }) {
  const { data, error } = await supabaseServidor().from('gps_cargas')
    .insert({ archivo: String(archivo).slice(0, 200), filas, desde, hasta, usuario_email: autor })
    .select('id').single();
  if (error) throw new Error('No se pudo crear la carga');
  return data.id;
}

/** Guarda un lote; las pasadas que ya estaban no se tocan. @returns cuántas eran nuevas */
export async function guardarLote(cargaId, filas) {
  const { error, count } = await supabaseServidor().from('gps_pasadas')
    .upsert(filas.map((f) => ({ ...f, carga_id: cargaId })), { onConflict: 'patente,entrada,portico', ignoreDuplicates: true, count: 'exact' });
  if (error) throw new Error('No se pudo guardar el lote');
  return count ?? 0;
}

export async function cerrarCarga(cargaId) {
  const { data, error } = await supabaseServidor().rpc('cerrar_gps_carga', { p_carga_id: cargaId });
  if (error) throw new Error('No se pudo cerrar la carga');
  return data;
}

/** Lo que muestra la pestaña: la comparación y de cuándo es cada fuente. */
export async function leerComparacion() {
  const sb = supabaseServidor();
  const [gps, bills, asignaciones, conductores, maestra, ultimaGps, ultimaBills] = await Promise.all([
    todas(() => sb.rpc('gps_por_dia', { p_desde: COMPARAR_DESDE })),
    todas(() => sb.from('bills').select('referencia, patente, conductor, conductor_id, monto, cruces, creado')
      .eq('tipo', 'Toll').gte('creado', sumarDias(COMPARAR_DESDE, 1)).order('creado').order('referencia')),
    todas(() => sb.from('asignaciones').select('patente, conductor_id, desde, hasta').order('desde')),
    todas(() => sb.from('conductores').select('id, nombre').order('id')),
    leerMaestra(),
    sb.from('gps_cargas').select('archivo, filas, nuevas, desde, hasta, usuario_email, creado')
      .eq('terminada', true).order('creado', { ascending: false }).limit(1).maybeSingle(),
    sb.from('cargas').select('archivo, creado').eq('tipo', 'bills').eq('aplicada', true)
      .order('creado', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const encargados = Object.fromEntries(maestra.filas.map((f) => [f.patente, f.encargado.valor]));
  const resultado = compararPeajes({
    gpsDias: gps.map((g) => ({ patente: g.patente, dia: String(g.dia).slice(0, 10), monto: Number(g.monto), pasadas: g.pasadas })),
    bills: bills.map((b) => ({ ...b, conductorId: b.conductor_id, monto: Number(b.monto) })),
    asignaciones: asignaciones.map((a) => ({ patente: a.patente, conductorId: a.conductor_id, desde: a.desde, hasta: a.hasta })),
    nombres: new Map(conductores.map((c) => [c.id, c.nombre])),
    encargados,
  });
  return { ...resultado, cargaGps: ultimaGps.data ?? null, cargaBills: ultimaBills.data ?? null };
}
