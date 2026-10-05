export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSesionConductor } from '@/lib/sesion-conductor';
import { estadoFotos } from '@/lib/portal/fotos';

/** Qué fotos le tocan al conductor de la sesión (levantamiento o revisión). */
export async function GET() {
  const sesion = await getSesionConductor();
  if (!sesion) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!sesion.conductorId) return NextResponse.json({ error: 'sin_ficha' }, { status: 403 });
  try {
    const estado = await estadoFotos(sesion);
    if (!estado) return NextResponse.json({ error: 'sin_auto' }, { status: 403 });
    return NextResponse.json(estado, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[conductor/fotos]', err.message);
    return NextResponse.json({ error: 'interno' }, { status: 500 });
  }
}
