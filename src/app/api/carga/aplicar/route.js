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
import { sincronizarHoja } from '@/lib/maestra/servidor';
import { leerFilas, billsDeFilas } from '@/lib/bills/archivo';
import { multasDeFilas } from '@/lib/multas/reporte';
import { guardarHistoria } from '@/lib/historia/versiones';

/**
 * Aplica cargas ya revisadas. Cada una entra completa o no entra
 * (función aplicar_carga, migraciones 0002, 0003, 0007 y 0008). Si una carga tiene
 * avisos —recalculados ahora, porque otra persona pudo aplicar un archivo
 * más nuevo mientras tanto— solo se aplica si se confirmó.
 * Bills y multas además se copian a Drive para el reporte de deudas actual, y
 * con conductores o autos la maestra se vuelve a escribir en Control Flota.
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
    .select('id, tipo, archivo, ruta_storage, aplicada, filas, sha256, numero_export, resumen, creado').in('id', ids);
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

      const { filas, buffer } = await leerArchivo(c.ruta_storage);
      let conductorDe;
      if (c.tipo === 'vehicles') {
        // Conductores recién aplicados en este mismo lote ya están en la base.
        const indice = crearIndice(await conductoresBase());
        conductorDe = (a) => buscarConductor({ nombre: a.conductor, patente: a.patente }, indice)?.id ?? null;
      }
      if (c.tipo === 'bills' || c.tipo === 'fines') {
        // Miles de filas con los mismos pocos conductores: se busca una vez cada uno.
        const indice = crearIndice(await conductoresBase());
        const memo = new Map();
        conductorDe = (f) => {
          const k = `${f.conductor}|${f.patente}|${f.telefono ?? ''}`;
          if (!memo.has(k)) memo.set(k, buscarConductor({ nombre: f.conductor, patente: f.patente, telefono: f.telefono }, indice)?.id ?? null);
          return memo.get(k);
        };
      }
      const datos = payloadPara(analizarExport(filas, {}, hoy), conductorDe);
      // Los despedidos van a su propia tabla (migración 0017): no tocan la maestra
      const { data: r, error: e } = c.tipo === 'despedidos'
        ? await sb.rpc('aplicar_despedidos', { p_datos: datos, p_carga_id: c.id })
        : await sb.rpc('aplicar_carga', { p_tipo: c.tipo, p_datos: datos, p_carga_id: c.id, p_hoy: hoy });
      if (e) {
        if (e.message === 'YA_APLICADA') { resultados.push({ ...base, ok: false, motivo: 'ya_aplicada' }); continue; }
        throw new Error(e.message);
      }
      // Historia de bills (cuándo se pagó cada una), leída igual que el reporte.
      if (c.tipo === 'bills') {
        await guardarHistoria(sb, 'bills', { archivo: c.archivo, cargaId: c.id, subido: c.creado, origen: 'carga' }, billsDeFilas(leerFilas(buffer, c.archivo)))
          .catch((eh) => console.error('carga/aplicar historia bills', eh.message));
      }
      if (c.tipo === 'fines') {
        const leido = multasDeFilas(leerFilas(buffer, c.archivo, { html: false }));
        await guardarHistoria(sb, 'fines', { archivo: c.archivo, cargaId: c.id, subido: c.creado, origen: 'carga', formatoDesconocido: leido.formatoDesconocido, encabezado: leido.encabezado }, leido.filas)
          .catch((em) => console.error('carga/aplicar historia multas', em.message));
      }
      const drive = (c.tipo === 'bills' || c.tipo === 'fines') ? await copiarADrive(c) : null;
      resultados.push({ ...base, ok: true, resultado: r, drive });
    } catch (err) {
      console.error('carga/aplicar', c.tipo, err.message);
      resultados.push({ ...base, ok: false, motivo: 'error' });
    }
  }
  // Con conductores o autos nuevos, la maestra cambia: se copia a la hoja.
  let hoja = null;
  if (resultados.some((r) => r.ok && (r.tipo === 'drivers' || r.tipo === 'vehicles'))) {
    try { hoja = await sincronizarHoja(); } catch (err) { console.error('carga/aplicar hoja', err.message); hoja = { error: true }; }
  }
  return NextResponse.json({ resultados, hoja });
}
