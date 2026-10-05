export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { hoyEnChile } from '@/lib/carga/payload';
import { fichaVehiculo } from '@/lib/historial/servidor';

/** Ficha de un auto. El taller no recibe RUT ni teléfono del conductor. */
export async function GET(_request, { params }) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'historial')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  try {
    const ficha = await fichaVehiculo(params.patente, session.user, hoyEnChile());
    if (!ficha) return NextResponse.json({ error: 'no_existe' }, { status: 404 });
    return NextResponse.json(ficha, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('historial/ficha', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}
