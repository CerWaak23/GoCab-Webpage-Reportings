export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga } from '@/lib/carga/permisos';
import { hoyEnChile, ordenarParaAplicar, payloadPara } from '@/lib/carga/payload';
import { avisosCarga } from '@/lib/carga/avisos';
import { analizarExport } from '@/lib/fleet';
import { crearIndice, buscarConductor } from '@/lib/fleet/identidad';
import { supabaseServidor } from '@/lib/supabase/server';
import { leerArchivo, cargasPrevias, conductoresBase } from '@/lib/carga/servidor';
import { copiarADrive } from '@/lib/carga/drive';

/**
 * Aplica cargas ya revisadas. Cada una entra completa o no entra
 * (función aplicar_carga, migraciones 0002 y 0003). Si una carga tiene
 * avisos —recalculados ahora, porque otra persona pudo aplicar un archivo
 * más nuevo mientras tanto— solo se aplica si se confirmó.
 * Bills y multas además se copian a Drive para el reporte de deudas actual.
 */
export async function POST(request) {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'aplicar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });

  const { ids, confirmados = [] } = await request.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 8 || !Array.isArray(confirmados)) {
    return NextResponse.json({ error: 'ids' }, { status: 400 });
  }

  const sb = supabaseServidor();
  const { data: cargas, error } = await sb.from('cargas')
    .select('id, tipo, archivo, ruta_storage, aplicada, filas, sha256, numero_export, resumen').in('id', ids);
  if (error) return NextResponse.json({ error: 'base' }, { status: 500 });

  const hoy = hoyEnChile();
  const resultados = [];
  for (const c of ordenarParaAplicar(cargas)) {
    const base = { id: c.id, tipo: c.tipo, archivo: c.archivo };
    if (c.aplicada) { resultados.push({ ...base, ok: false, motivo: 'ya_aplicada' }); continue; }
    try {
      const avisos = avisosCarga(
        { tipo: c.tipo, filas: c.filas, numero: c.numero_export, sha256: c.sha256, graves: c.resumen?.calidad?.graves },
        await cargasPrevias(c.tipo, c.id),
      );
      if (avisos.length && !confirmados.includes(c.id)) {
        resultados.push({ ...base, ok: false, motivo: 'confirmar', avisos });
        continue;
      }

      const { filas } = await leerArchivo(c.ruta_storage);
      let conductorDe;
      if (c.tipo === 'vehicles') {
        // Conductores recién aplicados en este mismo lote ya están en la base.
        const indice = crearIndice(await conductoresBase());
        conductorDe = (a) => buscarConductor({ nombre: a.conductor, patente: a.patente }, indice)?.id ?? null;
      }
      const datos = payloadPara(analizarExport(filas, {}, hoy), conductorDe);
      const { data: r, error: e } = await sb.rpc('aplicar_carga', {
        p_tipo: c.tipo, p_datos: datos, p_carga_id: c.id, p_hoy: hoy,
      });
      if (e) {
        if (e.message === 'YA_APLICADA') { resultados.push({ ...base, ok: false, motivo: 'ya_aplicada' }); continue; }
        throw new Error(e.message);
      }
      const drive = (c.tipo === 'bills' || c.tipo === 'fines') ? await copiarADrive(c) : null;
      resultados.push({ ...base, ok: true, resultado: r, drive });
    } catch (err) {
      console.error('carga/aplicar', c.tipo, err.message);
      resultados.push({ ...base, ok: false, motivo: 'error' });
    }
  }
  return NextResponse.json({ resultados });
}
