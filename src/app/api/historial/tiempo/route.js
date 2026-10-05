export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { flotaEnElTiempo } from '@/lib/historial/servidor';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Flota por períodos entre dos fechas (máximo un año). */
export async function GET(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'historial')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');
  if (!FECHA.test(desde || '') || !FECHA.test(hasta || '') || desde > hasta
      || Date.parse(hasta) - Date.parse(desde) > 366 * 86400000) {
    return NextResponse.json({ error: 'rango' }, { status: 400 });
  }
  try {
    return NextResponse.json(await flotaEnElTiempo(desde, hasta), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('historial/tiempo', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}
