export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga } from '@/lib/carga/permisos';
import { validarLote, normalizarFechaHora } from '@/lib/peajes/gps';
import { leerComparacion, iniciarCarga, guardarLote, cerrarCarga } from '@/lib/peajes/servidor';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Peajes del GPS contra lo cargado en Fleet, por conductor y semana de cobro. */
export async function GET() {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'revisar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });
  try {
    return NextResponse.json(await leerComparacion(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('peajes-gps', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}

/**
 * Carga del Listado de TAGs, que el navegador lee y manda en lotes:
 *   { accion: 'iniciar', archivo, filas, desde, hasta } → { cargaId }
 *   { accion: 'lote', cargaId, pasadas: [[...CAMPOS]] } → { nuevas }
 *   { accion: 'cerrar', cargaId }                       → { nuevas }
 */
export async function POST(request) {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'aplicar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });

  const cuerpo = await request.json().catch(() => ({}));
  try {
    if (cuerpo.accion === 'iniciar') {
      const filas = Number(cuerpo.filas);
      const desde = normalizarFechaHora(cuerpo.desde);
      const hasta = normalizarFechaHora(cuerpo.hasta);
      if (!cuerpo.archivo || !Number.isInteger(filas) || filas <= 0 || !desde || !hasta) {
        return NextResponse.json({ error: 'datos' }, { status: 400 });
      }
      const cargaId = await iniciarCarga({ archivo: cuerpo.archivo, filas, desde, hasta, autor: session.user.email });
      return NextResponse.json({ cargaId });
    }
    if (!UUID.test(String(cuerpo.cargaId))) return NextResponse.json({ error: 'datos' }, { status: 400 });
    if (cuerpo.accion === 'lote') {
      const v = validarLote(cuerpo.pasadas);
      if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });
      return NextResponse.json({ nuevas: await guardarLote(cuerpo.cargaId, v.filas) });
    }
    if (cuerpo.accion === 'cerrar') return NextResponse.json({ nuevas: await cerrarCarga(cuerpo.cargaId) });
    return NextResponse.json({ error: 'accion' }, { status: 400 });
  } catch (err) {
    console.error('peajes-gps/' + cuerpo.accion, err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}
