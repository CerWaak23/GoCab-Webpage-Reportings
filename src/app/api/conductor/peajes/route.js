export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSesionConductor } from '@/lib/sesion-conductor';
import { readPlateTransactions, snapshotsEnabled } from '@/lib/tolls-snapshot';

const noStore = { 'Cache-Control': 'no-store' };

/**
 * Peajes del conductor conectado.
 *
 * La patente sale de la cookie firmada, nunca de la URL: con ?patente= en la
 * query cualquiera cambiaría el valor y vería los peajes de otro conductor.
 *
 * Lee del snapshot que deja el cron. Sin snapshot no hay plan B a propósito:
 * calcular en vivo son ~8 s de descarga y parseo de Drive, y esto lo abren
 * decenas de conductores desde el celular.
 */
export async function GET() {
  try {
    const sesion = await getSesionConductor();
    if (!sesion) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: noStore });
    }

    if (!snapshotsEnabled()) {
      return NextResponse.json(
        { error: 'Los datos todavía no están disponibles.' },
        { status: 503, headers: noStore }
      );
    }

    const snap = await readPlateTransactions(sesion.patente);
    if (!snap) {
      return NextResponse.json(
        { error: 'Los datos todavía no están disponibles.' },
        { status: 503, headers: noStore }
      );
    }

    // Se resuelven acá los índices del diccionario: al navegador le llega texto
    // listo para mostrar y no tres arreglos de búsqueda que no le sirven de nada.
    const transacciones = snap.transactions.map((t) => ({
      fecha: t.fechaStr,
      hora: t.horaStr,
      valor: t.valor,
      autopista: snap.autopistas[t.ai] || '',
      portico: snap.porticos[t.pi] || '',
    }));

    return NextResponse.json({
      nombre: sesion.nombre,
      patente: sesion.patente,
      actualizado: snap.generatedAt,
      transacciones,
    }, { headers: noStore });

  } catch (err) {
    console.error('[conductor/peajes]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: noStore });
  }
}
