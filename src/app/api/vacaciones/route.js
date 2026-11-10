export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { supabaseServidor } from '@/lib/supabase/server';
import { validarSolicitud } from '@/lib/vacaciones';

const SIN_CACHE = { 'Cache-Control': 'no-store' };
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const faltaMigracion = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));

/** El calendario de vacaciones de todo el equipo: desde el año pasado en adelante. */
export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'vacaciones')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const desde = `${Number(hoyChile().slice(0, 4)) - 1}-01-01`;
  const { data, error } = await supabaseServidor().from('vacaciones')
    .select('id, usuario_email, nombre, desde, hasta, dias, nota, estado, motivo, creado, revisado_por, revisado_en')
    .gte('hasta', desde).order('desde');
  if (faltaMigracion(error)) return NextResponse.json({ error: 'sin_migracion' }, { status: 503, headers: SIN_CACHE });
  if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
  return NextResponse.json({
    vacaciones: data, hoy: hoyChile(),
    yo: { email: session.user.email, nombre: session.user.name },
    puedeAprobar: !!session.user.isManager,
  }, { headers: SIN_CACHE });
}

/**
 *   { accion: 'solicitar', desde, hasta, nota? }   las de gerencia quedan aprobadas
 *   { accion: 'revisar', id, aprobar, motivo? }     solo gerencia
 *   { accion: 'cancelar', id }                      el dueño (si no ha empezado) o gerencia
 */
export async function POST(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'vacaciones')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const sb = supabaseServidor();
  const yo = session.user.email;
  const gerencia = !!session.user.isManager;
  const ahora = new Date().toISOString();

  if (body.accion === 'solicitar') {
    const v = validarSolicitud(body, hoyChile());
    if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });
    // No dos solicitudes vigentes propias que se pisen
    const { data: mias } = await sb.from('vacaciones').select('id').eq('usuario_email', yo)
      .in('estado', ['solicitada', 'aprobada']).lte('desde', v.hasta).gte('hasta', v.desde);
    if (mias?.length) return NextResponse.json({ error: 'repetida' }, { status: 409 });
    const { error } = await sb.from('vacaciones').insert({
      usuario_email: yo, nombre: session.user.name || yo, ...v,
      estado: gerencia ? 'aprobada' : 'solicitada',
      ...(gerencia ? { revisado_por: yo, revisado_en: ahora } : {}),
    });
    if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
    return NextResponse.json({ ok: true, aprobada: gerencia });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'datos' }, { status: 400 });
  const { data: v } = await sb.from('vacaciones').select('*').eq('id', id).maybeSingle();
  if (!v) return NextResponse.json({ error: 'no_existe' }, { status: 404 });

  if (body.accion === 'revisar') {
    if (!gerencia) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
    if (v.estado !== 'solicitada') return NextResponse.json({ error: 'ya_revisada' }, { status: 409 });
    const { error } = await sb.from('vacaciones').update({
      estado: body.aprobar ? 'aprobada' : 'rechazada',
      motivo: body.aprobar ? null : String(body.motivo || '').trim().slice(0, 300) || null,
      revisado_por: yo, revisado_en: ahora,
    }).eq('id', id);
    if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.accion === 'cancelar') {
    const propia = String(v.usuario_email).toLowerCase() === String(yo).toLowerCase();
    if (!gerencia && !(propia && v.desde > hoyChile())) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
    if (!['solicitada', 'aprobada'].includes(v.estado)) return NextResponse.json({ error: 'ya_revisada' }, { status: 409 });
    const { error } = await sb.from('vacaciones').update({ estado: 'cancelada', revisado_por: yo, revisado_en: ahora }).eq('id', id);
    if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'accion' }, { status: 400 });
}
