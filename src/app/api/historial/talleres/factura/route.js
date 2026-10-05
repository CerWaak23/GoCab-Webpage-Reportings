export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { urlFactura } from '@/lib/historial/talleresServidor';

/** URL firmada para subir la factura de la salida directo a Storage. */
export async function POST(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'historial')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const cuerpo = await request.json().catch(() => ({}));
  if (!(cuerpo.tamano > 0 && cuerpo.tamano <= 15 * 1024 * 1024)) return NextResponse.json({ error: 'tamano' }, { status: 400 });
  try {
    const r = await urlFactura(cuerpo);
    if (r.error) return NextResponse.json(r, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error('historial/talleres/factura', err.message);
    return NextResponse.json({ error: 'storage' }, { status: 500 });
  }
}
