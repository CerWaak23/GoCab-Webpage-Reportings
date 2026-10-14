export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga } from '@/lib/carga/permisos';
import { validarEdicion, CAMPOS_AUTO } from '@/lib/maestra/maestra';
import { leerMaestra, guardarEdicion, sincronizarHoja, compararConHojaOriginal } from '@/lib/maestra/servidor';

/**
 * Maestra de Control Flota: la ve quien ve Carga de datos. Con ?comparar=1
 * agrega en qué difiere de la pestaña que se mantenía a mano.
 */
export async function GET(request) {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'revisar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });
  try {
    const comparar = new URL(request.url).searchParams.get('comparar') === '1';
    const [datos, diferencias] = await Promise.all([
      leerMaestra(),
      comparar ? compararConHojaOriginal().catch((err) => { console.error('maestra/comparar', err.message); return { error: true }; }) : null,
    ]);
    return NextResponse.json({ ...datos, diferencias, puedeEditar: !permisoCarga(session.user, 'aplicar') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('maestra', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}

/**
 * Corrige un campo: { campo, valor, patente } (encargado, tipo) o
 * { campo, valor, conductorId } (nombre, rut). Valor vacío = volver a Fleet.
 * Después copia la maestra a la hoja; si eso falla, la corrección igual queda.
 */
export async function POST(request) {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'aplicar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });

  const { campo, valor, patente, conductorId } = await request.json().catch(() => ({}));
  const v = validarEdicion(campo, valor);
  if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });
  if (CAMPOS_AUTO.includes(campo) ? !patente : !conductorId) return NextResponse.json({ error: 'destino' }, { status: 400 });

  try {
    await guardarEdicion({ campo, valor: v.valor, patente, conductorId, autor: session.user.email });
  } catch (err) {
    console.error('maestra/editar', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
  let hoja = null;
  try { hoja = await sincronizarHoja(); } catch (err) { console.error('maestra/hoja', err.message); }
  return NextResponse.json({ ok: true, valor: v.valor, hoja });
}
