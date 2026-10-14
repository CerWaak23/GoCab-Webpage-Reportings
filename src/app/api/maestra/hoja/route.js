export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga } from '@/lib/carga/permisos';
import { sincronizarHoja } from '@/lib/maestra/servidor';

/** Copia la maestra a la hoja de Control Flota ahora. */
export async function POST() {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'aplicar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });
  try {
    return NextResponse.json({ ok: true, hoja: await sincronizarHoja() });
  } catch (err) {
    console.error('maestra/hoja', err.message);
    // Sin permiso de edición sobre la planilla, Google responde 403.
    return NextResponse.json({ error: /permission|403/i.test(err.message) ? 'hoja_permiso' : 'hoja' }, { status: 500 });
  }
}
