export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga } from '@/lib/carga/permisos';
import { hoyEnChile, ordenarParaAplicar, payloadPara } from '@/lib/carga/payload';
import { analizarExport } from '@/lib/fleet';
import { supabaseServidor } from '@/lib/supabase/server';
import { leerArchivo } from '@/lib/carga/servidor';
import { copiarADrive } from '@/lib/carga/drive';

/**
 * Aplica cargas ya revisadas. Cada una entra completa o no entra
 * (función aplicar_carga de la migración 0002). Bills y multas además se
 * copian a su carpeta de Drive para que el reporte de deudas actual las lea.
 */
export async function POST(request) {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'aplicar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });

  const { ids } = await request.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 8) {
    return NextResponse.json({ error: 'ids' }, { status: 400 });
  }

  const sb = supabaseServidor();
  const { data: cargas, error } = await sb.from('cargas')
    .select('id, tipo, archivo, ruta_storage, aplicada').in('id', ids);
  if (error) return NextResponse.json({ error: 'base' }, { status: 500 });

  const hoy = hoyEnChile();
  const resultados = [];
  for (const c of ordenarParaAplicar(cargas.filter((x) => !x.aplicada))) {
    try {
      const filas = await leerArchivo(c.ruta_storage);
      const datos = payloadPara(analizarExport(filas, {}, hoy));
      const { data: r, error: e } = await sb.rpc('aplicar_carga', {
        p_tipo: c.tipo, p_datos: datos, p_carga_id: c.id, p_hoy: hoy,
      });
      if (e) throw new Error(e.message);
      const drive = (c.tipo === 'bills' || c.tipo === 'fines') ? await copiarADrive(c) : null;
      resultados.push({ id: c.id, tipo: c.tipo, archivo: c.archivo, ok: true, resultado: r, drive });
    } catch (err) {
      console.error('carga/aplicar', c.tipo, err.message);
      resultados.push({ id: c.id, tipo: c.tipo, archivo: c.archivo, ok: false });
    }
  }
  return NextResponse.json({ resultados });
}
