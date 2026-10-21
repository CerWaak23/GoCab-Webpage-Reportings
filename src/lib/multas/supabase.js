import 'server-only';
import { supabaseServidor } from '@/lib/supabase/server';
import { reporteMultas } from './reporte';

/** Reporte de multas desde la historia en Supabase. Lo usan /api/multas y Despedidos. */
export async function reporteDesdeSupabase() {
  const sb = supabaseServidor();
  const todas = async (tabla, columnas) => {
    const out = [];
    for (let desde = 0; ; desde += 1000) {
      // Por archivo y, dentro de cada uno, en el orden de las filas del export.
      const { data, error } = await sb.from(tabla).select(columnas)
        .order('subido').order(tabla.endsWith('_versiones') ? 'archivo_id' : 'id')
        .order(tabla.endsWith('_versiones') ? 'orden' : 'id').order('id')
        .range(desde, desde + 999);
      if (error) throw new Error(error.message);
      out.push(...data);
      if (data.length < 1000) return out;
    }
  };
  const [archivos, versiones] = await Promise.all([
    todas('multas_archivos', 'id, archivo, subido, formato_desconocido, encabezado'),
    todas('multas_versiones', 'id, archivo_id, clave, base, referencia, fecha_contravencion, cargo, pago, estado, conductor, vehiculo, creado, descripcion'),
  ]);
  if (archivos.length === 0) throw new Error('Supabase no tiene exports de multas');
  const porArchivo = new Map();
  for (const v of versiones) {
    if (!porArchivo.has(v.archivo_id)) porArchivo.set(v.archivo_id, []);
    porArchivo.get(v.archivo_id).push({
      clave: v.clave, base: v.base, ref: v.referencia, fechaContravencion: v.fecha_contravencion || '',
      cargo: Number(v.cargo), pago: Number(v.pago), estado: v.estado || '', conductor: v.conductor || '',
      vehiculo: v.vehiculo || '', creado: v.creado || '', descripcion: v.descripcion || '',
    });
  }
  return reporteMultas(archivos.map((a) => ({
    name: a.archivo,
    modifiedTime: new Date(a.subido).toISOString(),
    formatoDesconocido: a.formato_desconocido,
    encabezado: a.encabezado || [],
    filas: porArchivo.get(a.id) || [],
  })));
}
