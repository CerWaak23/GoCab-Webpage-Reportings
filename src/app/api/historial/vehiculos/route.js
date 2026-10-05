export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { hoyEnChile } from '@/lib/carga/payload';
import { listaVehiculos } from '@/lib/historial/servidor';

/** Lista de la flota con el estado de cada auto. */
export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'historial')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  try {
    return NextResponse.json(await listaVehiculos(hoyEnChile()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('historial/vehiculos', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}
