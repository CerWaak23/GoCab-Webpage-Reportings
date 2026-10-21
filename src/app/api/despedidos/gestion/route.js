export const dynamic = 'force-dynamic';

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { supabaseServidor } from '@/lib/supabase/server';

const CONCEPTOS = ['tags', 'multas', 'renta', 'danos', 'otro'];
const MAXIMO = 50_000_000; // un monto más grande que esto es un error de tipeo

/**
 * Lo que registra el coordinador sobre un despedido. Cada cambio guarda quién
 * lo hizo y cuándo.
 *
 * Acciones:
 *   anexo        { valor: boolean }                        firmó el anexo de DICOM
 *   ajuste       { monto, concepto, nota }                 deuda que no está en Fleet (negativo rebaja)
 *   quitarAjuste { id }
 *   devuelto     { monto, fecha }                          garantía ya devuelta
 *   nota         { texto }
 */
export async function POST(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'despedidos')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const clave = String(body.clave || '');
  if (!/^(rut|nom):.{2,120}$/.test(clave)) return NextResponse.json({ error: 'clave' }, { status: 400 });

  const sb = supabaseServidor();
  const { data: existe } = await sb.from('despedidos').select('clave').eq('clave', clave).maybeSingle();
  if (!existe) return NextResponse.json({ error: 'no_existe' }, { status: 404 });

  const { data: actual } = await sb.from('despedidos_gestion').select('*').eq('clave', clave).maybeSingle();
  const g = actual || { clave, ajustes: [], devuelto: 0, anexo_dicom: false };
  const por = session.user.email;
  const ahora = new Date().toISOString();
  const cambios = {};

  if (body.accion === 'anexo') {
    cambios.anexo_dicom = !!body.valor;
    cambios.anexo_por = body.valor ? por : null;
    cambios.anexo_fecha = body.valor ? ahora : null;
  } else if (body.accion === 'ajuste') {
    const monto = Math.round(Number(body.monto));
    if (!Number.isFinite(monto) || monto === 0 || Math.abs(monto) > MAXIMO) return NextResponse.json({ error: 'monto' }, { status: 400 });
    const concepto = CONCEPTOS.includes(body.concepto) ? body.concepto : 'otro';
    cambios.ajustes = [...(g.ajustes || []), {
      id: randomUUID(), monto, concepto, nota: String(body.nota || '').trim().slice(0, 300), por, fecha: ahora,
    }];
  } else if (body.accion === 'quitarAjuste') {
    cambios.ajustes = (g.ajustes || []).filter((a) => a.id !== body.id);
  } else if (body.accion === 'devuelto') {
    const monto = Math.round(Number(body.monto));
    if (!Number.isFinite(monto) || monto < 0 || monto > MAXIMO) return NextResponse.json({ error: 'monto' }, { status: 400 });
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) ? body.fecha : null;
    cambios.devuelto = monto;
    cambios.devuelto_fecha = monto > 0 ? fecha : null;
  } else if (body.accion === 'nota') {
    cambios.nota = String(body.texto || '').trim().slice(0, 1000) || null;
  } else {
    return NextResponse.json({ error: 'accion' }, { status: 400 });
  }

  const { error } = await sb.from('despedidos_gestion').upsert({
    clave,
    ajustes: g.ajustes || [],
    devuelto: g.devuelto || 0,
    anexo_dicom: !!g.anexo_dicom,
    ...cambios,
    actualizado: ahora,
    actualizado_por: por,
  });
  if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
