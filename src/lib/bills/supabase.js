import 'server-only';
import { supabaseServidor } from '@/lib/supabase/server';
import { reporteDesdeVersiones, consolidarPorDia } from './desdeVersiones';

/** Reporte de bills desde la historia en Supabase. Lo usan /api/bills y Despedidos. */
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
    todas('bills_archivos', 'id, archivo, subido, filas, filas_sin_conductor, referencias'),
    todas('bills_versiones', 'id, referencia, archivo_id, tipo, estado, vehiculo, conductor, telefono, descripcion, monto, pagado, creado_texto'),
  ]);
  if (archivos.length === 0) throw new Error('Supabase no tiene exports de bills');
  return reporteDesdeVersiones(...consolidarPorDia(archivos, versiones));
}
