export const dynamic = 'force-dynamic';
// El proceso completo tarda ~7 s hoy y sube con cada archivo nuevo de peajes.
// El techo por defecto en Hobby son 10 s, así que se pide el máximo del plan.
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { computeTolls, splitSnapshots } from '@/lib/tolls';
import { writeSnapshot, snapshotsEnabled } from '@/lib/tolls-snapshot';
import { getAppSession } from '@/lib/session';

/**
 * Recalcula los peajes y guarda los snapshots.
 *
 * Lo llama el cron de Vercel (ver vercel.json), que manda
 * `Authorization: Bearer $CRON_SECRET`. En Hobby el cron corre una vez al día,
 * así que también se puede lanzar a mano: cualquier gerente con sesión abierta
 * puede pegarle a esta URL para forzar la actualización cuando acaba de subir
 * un export nuevo, sin esperar al día siguiente.
 */
async function autorizado(request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization');
  if (secret && header === `Bearer ${secret}`) return 'cron';

  const session = await getAppSession();
  if (session?.user?.isManager) return 'manual';

  return null;
}

export async function GET(request) {
  const via = await autorizado(request);
  if (!via) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (!snapshotsEnabled()) {
    return NextResponse.json(
      { error: 'TOLLS_SNAPSHOT_FOLDER_ID no está configurada' },
      { status: 503 }
    );
  }

  const t0 = Date.now();
  try {
    const data = await computeTolls();
    const generatedAt = new Date().toISOString();
    const { index, plates } = splitSnapshots(data, generatedAt);

    const wIndex  = await writeSnapshot('index', index);
    const wPlates = await writeSnapshot('plates', plates);

    const resumen = {
      ok: true,
      via,
      generatedAt,
      ms: Date.now() - t0,
      transacciones: data.transactions.length,
      patentes: Object.keys(plates.byPlate).length,
      archivos: data.sources.length,
      snapshots: {
        index:  { bytes: wIndex.bytes,  creado: wIndex.created },
        plates: { bytes: wPlates.bytes, creado: wPlates.created },
      },
    };

    console.log('[cron/tolls]', JSON.stringify(resumen));
    return NextResponse.json(resumen, { headers: { 'Cache-Control': 'no-store' } });

  } catch (err) {
    console.error('[cron/tolls] fallo:', err);
    return NextResponse.json(
      { error: err.message, ms: Date.now() - t0 },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
