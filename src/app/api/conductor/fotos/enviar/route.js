export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSesionConductor } from '@/lib/sesion-conductor';
import { registrarEnvio } from '@/lib/portal/fotos';
import { UID } from '@/lib/historial/tomas';

/** Cierra el levantamiento o la revisión cuando todas las fotos ya están arriba. */
export async function POST(request) {
  const sesion = await getSesionConductor();
  if (!sesion?.conductorId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const envio = await request.json().catch(() => null);
  if (!envio || !UID.test(envio.uid || '') || typeof envio.fotos !== 'object' || !envio.aviso) {
    return NextResponse.json({ error: 'datos' }, { status: 400 });
  }
  try {
    const red = {
      ip: (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
      navegador: request.headers.get('user-agent'),
    };
    const r = await registrarEnvio(sesion, envio, red);
    if (r.error) return NextResponse.json(r, { status: r.status || 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error('[conductor/fotos/enviar]', err.message);
    return NextResponse.json({ error: 'interno' }, { status: 500 });
  }
}
