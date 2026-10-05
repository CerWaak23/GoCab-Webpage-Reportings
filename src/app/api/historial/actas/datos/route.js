export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeHacerActas } from '@/lib/historial/permisos';
import { datosProtocolo, conductoresParaElegir } from '@/lib/historial/actasServidor';
import { TIPOS_ACTA } from '@/lib/historial/actas';

/** Datos para abrir una entrega o recepción en el celular. */
export async function GET(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeHacerActas(session.user)) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get('tipo');
  if (!TIPOS_ACTA.includes(tipo)) return NextResponse.json({ error: 'tipo' }, { status: 400 });
  try {
    const datos = await datosProtocolo(searchParams.get('patente'), tipo);
    if (!datos) return NextResponse.json({ error: 'no_existe' }, { status: 404 });
    if (tipo === 'entrega') datos.conductores = await conductoresParaElegir();
    return NextResponse.json(datos, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('historial/actas/datos', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}
