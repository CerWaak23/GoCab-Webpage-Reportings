export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { hoyEnChile } from '@/lib/carga/payload';
import { vistaTalleres, registrarIngreso, registrarActualizacion, registrarSalida } from '@/lib/historial/talleresServidor';

async function sesion() {
  const session = await getAppSession();
  if (!session) return { error: NextResponse.json({ error: 'sin_sesion' }, { status: 401 }) };
  if (!puedeVerSeccion(session.user.role, 'historial')) return { error: NextResponse.json({ error: 'sin_permiso' }, { status: 403 }) };
  return { usuario: session.user };
}

/** Autos en taller, sin ingreso registrado, reemplazos y pasos anteriores. */
export async function GET() {
  const s = await sesion();
  if (s.error) return s.error;
  try {
    return NextResponse.json(await vistaTalleres(hoyEnChile()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('historial/talleres', err.message);
    return NextResponse.json({ error: 'base' }, { status: 500 });
  }
}

const ACCIONES = { ingreso: registrarIngreso, actualizacion: registrarActualizacion, salida: registrarSalida };

/** Ingreso, actualización o salida. Lo hace el encargado de taller, o coordinación y gerencia. */
export async function POST(request) {
  const s = await sesion();
  if (s.error) return s.error;
  const datos = await request.json().catch(() => null);
  const accion = ACCIONES[datos?.accion];
  if (!accion) return NextResponse.json({ error: 'accion' }, { status: 400 });
  try {
    const r = await accion(s.usuario, datos);
    if (r.error) return NextResponse.json(r, { status: r.status || 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error('historial/talleres', datos.accion, err.message);
    return NextResponse.json({ error: 'interno' }, { status: 500 });
  }
}
