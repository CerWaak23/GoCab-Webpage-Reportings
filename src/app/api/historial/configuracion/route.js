export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { supabaseServidor } from '@/lib/supabase/server';
import { validarChecklist, mismaChecklist, validarAjustes, AJUSTES } from '@/lib/historial/configuracion';
import { checklistVigente } from '@/lib/historial/actasServidor';

/** Configuración del Historial: checklist vigente y ajustes. La ve cualquiera; la cambia gerencia. */
export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  const sb = supabaseServidor();
  const [checklist, ajustes] = await Promise.all([
    checklistVigente(sb),
    sb.from('configuracion').select('clave, valor').in('clave', Object.keys(AJUSTES)),
  ]);
  return NextResponse.json({
    checklist,
    ajustes: Object.fromEntries((ajustes.data || []).map((a) => [a.clave, a.valor])),
    puedeEditar: !!session.user.isManager,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!session.user.isManager) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const { checklist, ajustes } = await request.json().catch(() => ({}));
  const sb = supabaseServidor();
  const out = {};

  if (ajustes) {
    const v = validarAjustes(ajustes);
    if (v.error) return NextResponse.json({ error: 'ajuste', clave: v.error }, { status: 400 });
    const filas = Object.entries(v.valores).map(([clave, valor]) => ({ clave, valor }));
    if (filas.length) {
      const { error } = await sb.from('configuracion').upsert(filas, { onConflict: 'clave' });
      if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
    }
    out.ajustes = v.valores;
  }

  if (checklist) {
    const v = validarChecklist(checklist);
    if (v.error) return NextResponse.json({ error: 'checklist', motivo: v.error }, { status: 400 });
    const actual = await checklistVigente(sb);
    if (actual && mismaChecklist(actual.items, v.grupos)) return NextResponse.json({ error: 'checklist', motivo: 'sin_cambios' }, { status: 400 });
    // Siempre una versión nueva: las actas anteriores conservan la suya (R10).
    const { data, error } = await sb.from('checklists')
      .insert({ version: (actual?.version || 0) + 1, items: v.grupos, creada_por: session.user.email })
      .select('version, items').single();
    if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
    out.checklist = data;
  }
  return NextResponse.json(out);
}
