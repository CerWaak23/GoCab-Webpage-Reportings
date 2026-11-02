export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga, permisoMaestra } from '@/lib/carga/permisos';
import { validarSubida, ESTADOS_MARCA } from '@/lib/peajes/facturas';
import { leerFacturas, subirCorrida, marcarAjuste } from '@/lib/peajes/facturasServidor';

/** Cruce de peajes contra facturas: la última corrida del proceso semanal y sus ajustes. */
export async function GET() {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'revisar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });
  try {
    const datos = await leerFacturas();
    return NextResponse.json({ ...datos, puedeMarcar: !permisoMaestra(session.user) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('peajes-facturas', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}

/**
 *   { accion: 'subir', corrida, cruce, facturas, ajustes }  → la corrida y el libro, leídos en el navegador
 *   { accion: 'marcar', id, estado, monto?, referencia? }   → solo gerencia: si un ajuste se aplicó
 */
export async function POST(request) {
  const session = await getAppSession();
  const cuerpo = await request.json().catch(() => ({}));

  if (cuerpo.accion === 'marcar') {
    const negado = permisoMaestra(session?.user);
    if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });
    const id = Number(cuerpo.id);
    const monto = cuerpo.monto === undefined || cuerpo.monto === null || cuerpo.monto === '' ? null : Number(cuerpo.monto);
    if (!Number.isInteger(id) || !ESTADOS_MARCA.includes(cuerpo.estado) || (monto !== null && !Number.isInteger(monto))) {
      return NextResponse.json({ error: 'datos' }, { status: 400 });
    }
    try {
      const r = await marcarAjuste({ id, estado: cuerpo.estado, monto, referencia: String(cuerpo.referencia ?? '').trim().slice(0, 200), autor: session.user.email });
      return NextResponse.json(r, { status: r.error ? 409 : 200 });
    } catch (err) {
      console.error('peajes-facturas/marcar', err.message);
      return NextResponse.json({ error: 'base' }, { status: 500 });
    }
  }

  if (cuerpo.accion === 'subir') {
    const negado = permisoCarga(session?.user, 'aplicar');
    if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });
    const invalido = validarSubida(cuerpo);
    if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });
    try {
      const { corrida, cruce, facturas, ajustes } = cuerpo;
      return NextResponse.json(await subirCorrida({ corrida, cruce, facturas, ajustes, autor: session.user.email }));
    } catch (err) {
      console.error('peajes-facturas/subir', err.message);
      return NextResponse.json({ error: 'base' }, { status: 500 });
    }
  }
  return NextResponse.json({ error: 'accion' }, { status: 400 });
}
