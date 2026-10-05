export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeHacerActas } from '@/lib/historial/permisos';
import { urlSubidaActa } from '@/lib/historial/actasServidor';

/** URL firmada para subir una foto, la cédula o la firma directo a Storage. */
export async function POST(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeHacerActas(session.user)) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const cuerpo = await request.json().catch(() => ({}));
  if (!(cuerpo.tamano > 0 && cuerpo.tamano <= 10 * 1024 * 1024)) return NextResponse.json({ error: 'tamano' }, { status: 400 });
  try {
    const r = await urlSubidaActa(cuerpo);
    if (r.error) return NextResponse.json(r, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error('historial/actas/subir', err.message);
    return NextResponse.json({ error: 'storage' }, { status: 500 });
  }
}
