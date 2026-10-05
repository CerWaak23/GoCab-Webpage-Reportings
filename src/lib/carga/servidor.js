import 'server-only';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { supabaseServidor } from '@/lib/supabase/server';

export const BUCKET = 'cargas';

/** Descarga un export desde Storage: sus filas como objetos y su huella. */
export async function leerArchivo(ruta) {
  const { data, error } = await supabaseServidor().storage.from(BUCKET).download(ruta);
  if (error) throw new Error('No se pudo leer el archivo subido');
  const buf = Buffer.from(await data.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  return {
    filas: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false }),
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

/** Conductores de la base en la forma que usa src/lib/fleet/identidad.js. */
export async function conductoresBase() {
  const { data, error } = await supabaseServidor().from('conductores').select('id, nombre, telefono, patentes_fleet');
  if (error) throw new Error('No se pudo leer la base');
  return data.map((c) => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, patentes: c.patentes_fleet || [] }));
}

/** Cargas ya aplicadas de un tipo, para los avisos de src/lib/carga/avisos.js. */
export async function cargasPrevias(tipo, excepto = null) {
  let q = supabaseServidor().from('cargas').select('id, filas, numero_export, sha256, creado')
    .eq('tipo', tipo).eq('aplicada', true);
  if (excepto) q = q.neq('id', excepto);
  const { data, error } = await q;
  if (error) throw new Error('No se pudo leer la base');
  return data;
}

/**
 * Estado actual para comparar contra un export: autos con su conductor
 * vigente y su última acta de entrega o recepción, y los conductores.
 */
export async function estadoBase() {
  const sb = supabaseServidor();
  const [autos, vigentes, actas, conductores] = await Promise.all([
    sb.from('autos').select('patente'),
    sb.from('asignaciones').select('patente, conductores(nombre)').is('hasta', null),
    sb.from('eventos').select('patente, tipo, fecha, conductores(nombre)').in('tipo', ['entrega', 'recepcion']).order('fecha', { ascending: false }),
    conductoresBase(),
  ]);
  for (const r of [autos, vigentes, actas]) if (r.error) throw new Error('No se pudo leer la base');

  const conductorDe = new Map(vigentes.data.map((v) => [v.patente, v.conductores?.nombre ?? null]));
  const ultimaActa = new Map();
  for (const e of actas.data) {
    if (!ultimaActa.has(e.patente)) ultimaActa.set(e.patente, { tipo: e.tipo, conductor: e.conductores?.nombre ?? null });
  }
  return {
    autos: autos.data.map((a) => ({ patente: a.patente, conductor: conductorDe.get(a.patente) ?? null, ultimaActa: ultimaActa.get(a.patente) ?? null })),
    conductores,
  };
}
