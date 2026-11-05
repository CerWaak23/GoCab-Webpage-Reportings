export const dynamic = 'force-dynamic';

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { supabaseServidor } from '@/lib/supabase/server';
import { CAMPOS_CAMBIO, validarCuenta } from '@/lib/fleet/despedidos';

const CONCEPTOS = ['tags', 'multas', 'renta', 'danos', 'otro'];
const MAXIMO = 50_000_000; // un monto más grande que esto es un error de tipeo

/**
 * Lo que registra el coordinador sobre un despedido. Cada cambio guarda quién
 * lo hizo y cuándo.
 *
 * Acciones:
 *   cambio       { campo, valor, anterior?, nota? }        corrige una casilla (de un coordinador: queda pendiente)
 *   revisar      { id, aprobar }                           gerencia aprueba o rechaza una propuesta
 *   cuenta       { cuenta: { titular, rut, banco, tipo, numero, email? } } o { borrar: true }
 *   listo        { valor: boolean }                        listo para devolver o para publicar en DICOM
 *   cerrado      { valor, tipo: devuelto|dicom, monto }    gerencia: ya se devolvió o se publicó
 *   anexo        { valor: boolean }                        firmó el anexo de DICOM (ya no se muestra)
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

  const esGerencia = !!session.user.isManager;
  const ahoraIso = new Date().toISOString();

  /* Corregir una casilla. Lo de gerencia queda aprobado al tiro (y descarta las
     propuestas que había de esa casilla); lo de un coordinador queda pendiente
     y no cuenta hasta que gerencia lo apruebe. */
  if (body.accion === 'cambio') {
    const valor = Math.round(Number(body.valor));
    if (!CAMPOS_CAMBIO.includes(body.campo) || !Number.isFinite(valor) || Math.abs(valor) > MAXIMO) {
      return NextResponse.json({ error: 'monto' }, { status: 400 });
    }
    if (body.campo !== 'renta' && body.campo !== 'ajustes' && valor < 0) return NextResponse.json({ error: 'monto' }, { status: 400 });
    if (esGerencia) {
      await sb.from('despedidos_cambios').update({ estado: 'rechazado', revisado_por: session.user.email, revisado_en: ahoraIso })
        .eq('clave', clave).eq('campo', body.campo).eq('estado', 'pendiente');
    }
    const { error } = await sb.from('despedidos_cambios').insert({
      clave, campo: body.campo, valor,
      anterior: Number.isFinite(Number(body.anterior)) ? Math.round(Number(body.anterior)) : null,
      nota: String(body.nota || '').trim().slice(0, 300) || null,
      estado: esGerencia ? 'aprobado' : 'pendiente',
      propuesto_por: session.user.email,
      ...(esGerencia ? { revisado_por: session.user.email, revisado_en: ahoraIso } : {}),
    });
    if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
    return NextResponse.json({ ok: true, pendiente: !esGerencia });
  }

  /* Aprobar o rechazar una propuesta: solo gerencia. Al aprobar una, las demás
     pendientes de esa casilla quedan rechazadas. */
  if (body.accion === 'revisar') {
    if (!esGerencia) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
    const { data: c } = await sb.from('despedidos_cambios').select('id, campo, estado').eq('id', Number(body.id)).eq('clave', clave).maybeSingle();
    if (!c || c.estado !== 'pendiente') return NextResponse.json({ error: 'no_existe' }, { status: 404 });
    const revisado = { revisado_por: session.user.email, revisado_en: ahoraIso };
    if (body.aprobar) {
      await sb.from('despedidos_cambios').update({ estado: 'rechazado', ...revisado })
        .eq('clave', clave).eq('campo', c.campo).eq('estado', 'pendiente').neq('id', c.id);
    }
    const { error } = await sb.from('despedidos_cambios').update({ estado: body.aprobar ? 'aprobado' : 'rechazado', ...revisado }).eq('id', c.id);
    if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

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
  } else if (body.accion === 'cuenta') {
    // Cuenta para devolver la garantía. Vacía = borrarla.
    if (body.borrar) {
      cambios.cuenta = null;
    } else {
      const v = validarCuenta(body.cuenta || {});
      if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });
      cambios.cuenta = v.cuenta;
    }
    cambios.cuenta_por = por;
    cambios.cuenta_en = ahora;
  } else if (body.accion === 'listo') {
    // El coordinador avisa que está listo para devolver o para publicar en DICOM
    cambios.listo = !!body.valor;
    cambios.listo_por = body.valor ? por : null;
    cambios.listo_en = body.valor ? ahora : null;
  } else if (body.accion === 'cerrado') {
    // Gerencia confirma que ya se devolvió la garantía o que se publicó en DICOM
    if (!esGerencia) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
    const tipo = body.tipo === 'devuelto' ? 'devuelto' : body.tipo === 'dicom' ? 'dicom' : null;
    const monto = Math.round(Number(body.monto) || 0);
    if (body.valor && (!tipo || monto < 0 || monto > MAXIMO)) return NextResponse.json({ error: 'datos' }, { status: 400 });
    cambios.cerrado = !!body.valor;
    cambios.cerrado_tipo = body.valor ? tipo : null;
    cambios.cerrado_monto = body.valor ? monto : null;
    cambios.cerrado_por = body.valor ? por : null;
    cambios.cerrado_en = body.valor ? ahora : null;
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
