export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSesionConductor } from '@/lib/sesion-conductor';
import { urlSubida } from '@/lib/portal/fotos';
import { UID } from '@/lib/historial/tomas';

const MAXIMO = 10 * 1024 * 1024;

/** URL firmada para subir una foto directo a Storage (no pasa por Vercel). */
export async function POST(request) {
  const sesion = await getSesionConductor();
  if (!sesion?.conductorId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { uid, toma, tamano } = await request.json().catch(() => ({}));
  if (!UID.test(uid || '') || !(tamano > 0 && tamano <= MAXIMO)) {
    return NextResponse.json({ error: 'datos' }, { status: 400 });
  }
  try {
    const r = await urlSubida(sesion, uid, toma);
    if (r.error) return NextResponse.json(r, { status: r.error === 'toma' ? 400 : 403 });
    return NextResponse.json(r);
  } catch (err) {
    console.error('[conductor/fotos/subir]', err.message);
    return NextResponse.json({ error: 'interno' }, { status: 500 });
  }
}
