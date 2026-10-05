export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeHacerActas } from '@/lib/historial/permisos';
import { registrarActa } from '@/lib/historial/actasServidor';

/** Registra un acta firmada (entrega o recepción) y genera su PDF. */
export async function POST(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeHacerActas(session.user)) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const acta = await request.json().catch(() => null);
  if (!acta) return NextResponse.json({ error: 'datos' }, { status: 400 });
  try {
    const red = {
      ip: (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
      navegador: request.headers.get('user-agent'),
    };
    const r = await registrarActa(session.user, acta, red);
    if (r.error) return NextResponse.json(r, { status: r.status || 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error('historial/actas', err.message);
    return NextResponse.json({ error: 'interno' }, { status: 500 });
  }
}
