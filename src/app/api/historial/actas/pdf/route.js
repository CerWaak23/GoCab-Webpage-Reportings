export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeHacerActas } from '@/lib/historial/permisos';
import { adjuntarPdf } from '@/lib/historial/actasServidor';

/** Reintenta el PDF de un acta firmada que quedó sin él. */
export async function POST(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeHacerActas(session.user)) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const { id } = await request.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/.test(id || '')) return NextResponse.json({ error: 'id' }, { status: 400 });
  try {
    return NextResponse.json({ ok: await adjuntarPdf(id) });
  } catch (err) {
    console.error('historial/actas/pdf', err.message);
    return NextResponse.json({ error: 'pdf' }, { status: 500 });
  }
}
