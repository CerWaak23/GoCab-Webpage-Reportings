export const dynamic = 'force-dynamic';
// Solo importa para el plan B (recalcular en vivo). La vía normal —leer el
// snapshot— responde en menos de un segundo.
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { computeTolls, splitSnapshots, normPlate } from '@/lib/tolls';
import { readSnapshot, readPlateTransactions, snapshotsEnabled } from '@/lib/tolls-snapshot';

const noStore = { 'Cache-Control': 'no-store' };

// ── Plan B ────────────────────────────────────────────────────────────────────
// Si todavía no hay snapshot (antes del primer cron, o si el cron falló) se
// calcula en vivo, que es lo que hacía este endpoint siempre. Se memoriza por
// instancia para que varias visitas seguidas no disparen el proceso completo
// una y otra vez.
//
// Nota: la versión anterior guardaba este resultado en process.cwd()/.cache.
// En Vercel el filesystem es de solo lectura salvo /tmp, así que esa escritura
// fallaba en silencio y cada arranque en frío repetía el trabajo entero.
let _memo = null;          // { at: epochMs, data }
let _enVuelo = null;       // promesa compartida si hay varias peticiones juntas
const MEMO_MS = 10 * 60 * 1000;

async function calcularEnVivo() {
  if (_memo && Date.now() - _memo.at < MEMO_MS) return _memo.data;
  if (_enVuelo) return _enVuelo;

  _enVuelo = computeTolls()
    .then((data) => {
      _memo = { at: Date.now(), data };
      return data;
    })
    .finally(() => { _enVuelo = null; });

  return _enVuelo;
}

export async function GET(request) {
  try {
    const plate = request.nextUrl?.searchParams?.get('plate');

    // ── ?plate=XXXX → solo las transacciones de esa patente ──────────────────
    if (plate) {
      const p = normPlate(plate);

      if (snapshotsEnabled()) {
        const desdeSnapshot = await readPlateTransactions(p);
        if (desdeSnapshot) {
          return NextResponse.json({ ...desdeSnapshot, _source: 'snapshot' }, { headers: noStore });
        }
      }

      const data = await calcularEnVivo();
      return NextResponse.json({
        transactions: data.transactions.filter(t => t.plate === p),
        autopistas:   data.autopistas,
        porticos:     data.porticos,
        tipoTarifas:  data.tipoTarifas,
        _source: 'computed',
      }, { headers: noStore });
    }

    // ── Por defecto → los agregados que consume el dashboard ─────────────────
    if (snapshotsEnabled()) {
      const index = await readSnapshot('index');
      if (index) {
        return NextResponse.json({ ...index, _source: 'snapshot' }, { headers: noStore });
      }
    }

    const data = await calcularEnVivo();
    const { index } = splitSnapshots(data, new Date().toISOString());
    return NextResponse.json({ ...index, _source: 'computed' }, { headers: noStore });

  } catch (err) {
    console.error('[tolls]', err);
    return NextResponse.json({ error: err.message }, { status: 500, headers: noStore });
  }
}
