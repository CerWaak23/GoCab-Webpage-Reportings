import 'server-only';
import * as XLSX from 'xlsx';
import { supabaseServidor } from '@/lib/supabase/server';

export const BUCKET = 'cargas';

/** Descarga un export desde Storage y devuelve sus filas como objetos. */
export async function leerArchivo(ruta) {
  const { data, error } = await supabaseServidor().storage.from(BUCKET).download(ruta);
  if (error) throw new Error('No se pudo leer el archivo subido');
  const buf = Buffer.from(await data.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
}

/**
 * Estado actual para comparar contra un export: autos con su conductor
 * vigente y su última acta de entrega o recepción, y nombres de conductores.
 */
export async function estadoBase() {
  const sb = supabaseServidor();
  const [autos, vigentes, actas, conductores] = await Promise.all([
    sb.from('autos').select('patente'),
    sb.from('asignaciones').select('patente, conductores(nombre)').is('hasta', null),
    sb.from('eventos').select('patente, tipo, fecha, conductores(nombre)').in('tipo', ['entrega', 'recepcion']).order('fecha', { ascending: false }),
    sb.from('conductores').select('nombre'),
  ]);
  for (const r of [autos, vigentes, actas, conductores]) if (r.error) throw new Error('No se pudo leer la base');

  const conductorDe = new Map(vigentes.data.map((v) => [v.patente, v.conductores?.nombre ?? null]));
  const ultimaActa = new Map();
  for (const e of actas.data) {
    if (!ultimaActa.has(e.patente)) ultimaActa.set(e.patente, { tipo: e.tipo, conductor: e.conductores?.nombre ?? null });
  }
  return {
    autos: autos.data.map((a) => ({ patente: a.patente, conductor: conductorDe.get(a.patente) ?? null, ultimaActa: ultimaActa.get(a.patente) ?? null })),
    conductores: conductores.data,
  };
}
