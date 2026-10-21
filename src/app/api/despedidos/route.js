export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { supabaseServidor } from '@/lib/supabase/server';
import { reporteDesdeSupabase as billsDesdeSupabase } from '@/lib/bills/supabase';
import { reporteDesdeSupabase as multasDesdeSupabase } from '@/lib/multas/supabase';
import { liquidar, asignarPorNombre } from '@/lib/fleet/despedidos';
import { normalizarNombre } from '@/lib/fleet/nombres';

const SIN_CACHE = { 'Cache-Control': 'no-store' };
const saldo = (x) => Math.max(0, (Number(x.amount) || 0) - (Number(x.paidAmount) || 0));

/** La tabla no existe hasta que se aplica la migración 0017 en Supabase. */
const faltaMigracion = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));

/**
 * Despedidos con su liquidación: lo que trae el export de Fleet (renta y
 * garantía), lo que deben en boletas y multas según la misma historia que usa
 * el reporte de deudas, y lo que registró cada coordinador.
 */
export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'despedidos')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });

  const sb = supabaseServidor();
  const [desp, gest, carga] = await Promise.all([
    sb.from('despedidos').select('clave, rut, nombre, nombre_fleet, telefono, activacion, despido, balance, garantia, comentario, actualizado'),
    sb.from('despedidos_gestion').select('*'),
    sb.from('cargas').select('archivo, creado, usuario_email').eq('tipo', 'despedidos').eq('aplicada', true)
      .order('creado', { ascending: false }).limit(1),
  ]);
  if (faltaMigracion(desp.error) || faltaMigracion(gest.error)) {
    return NextResponse.json({ error: 'sin_migracion' }, { status: 503, headers: SIN_CACHE });
  }
  if (desp.error || gest.error) return NextResponse.json({ error: 'base' }, { status: 500 });

  const despedidos = desp.data.map((d) => ({ ...d, nombreFleet: d.nombre_fleet }));
  const cobros = new Map(despedidos.map((d) => [d.clave, { tags: 0, otros: 0, multas: 0, nTags: 0, nOtros: 0, nMultas: 0 }]));

  // Mismas fuentes que el reporte de deudas. Si una falla, se muestra igual
  // con lo que haya y se avisa cuál faltó.
  const avisos = [];
  const [bills, multas] = await Promise.all([
    billsDesdeSupabase().catch((e) => { console.error('despedidos bills', e.message); avisos.push('bills'); return { bills: [] }; }),
    multasDesdeSupabase().catch((e) => { console.error('despedidos multas', e.message); avisos.push('multas'); return { fines: [] }; }),
  ]);
  // Una boleta a nombre de alguien que sigue activo es de él, aunque un
  // despedido tenga un nombre parecido ("CARLOS GONZÁLEZ" y "CARLOS GONZÁLEZ MUÑOZ").
  const { data: activos } = await sb.from('conductores').select('nombre, nombre_fleet').is('baja', null);
  const nombresDespedidos = new Set(despedidos.flatMap((d) => [d.nombre, d.nombre_fleet]).filter(Boolean).map(normalizarNombre));
  const nombresActivos = new Set((activos || []).flatMap((c) => [c.nombre, c.nombre_fleet]).filter(Boolean)
    .map(normalizarNombre).filter((n) => !nombresDespedidos.has(n)));
  const memo = new Map();
  const de = (nombre) => {
    if (!memo.has(nombre)) {
      memo.set(nombre, nombresActivos.has(normalizarNombre(nombre)) ? null : asignarPorNombre(despedidos, nombre));
    }
    return memo.get(nombre);
  };
  for (const b of bills.bills || []) {
    const s = saldo(b);
    if (s <= 0 || !b.driver) continue;
    const d = de(b.driver);
    if (!d) continue;
    const c = cobros.get(d.clave);
    if (/toll/i.test(b.type || '')) { c.tags += s; c.nTags++; } else { c.otros += s; c.nOtros++; }
  }
  for (const f of multas.fines || []) {
    const s = saldo(f);
    if (s <= 0 || !f.driver) continue;
    const d = de(f.driver);
    if (!d) continue;
    const c = cobros.get(d.clave);
    c.multas += s; c.nMultas++;
  }

  const gestion = new Map((gest.data || []).map((g) => [g.clave, g]));
  const filas = despedidos.map((d) => {
    const g = gestion.get(d.clave) || {};
    const c = cobros.get(d.clave);
    return {
      clave: d.clave,
      nombre: d.nombre,
      nombreFleet: d.nombre_fleet,
      telefono: d.telefono,
      activacion: d.activacion,
      despido: d.despido,
      comentario: d.comentario,
      balance: d.balance,
      garantia: d.garantia,
      cobros: c,
      gestion: {
        ajustes: g.ajustes || [],
        devuelto: g.devuelto || 0,
        devueltoFecha: g.devuelto_fecha || null,
        anexoDicom: !!g.anexo_dicom,
        anexoPor: g.anexo_por || null,
        anexoFecha: g.anexo_fecha || null,
        nota: g.nota || '',
        actualizadoPor: g.actualizado_por || null,
        actualizado: g.actualizado || null,
      },
      liquidacion: liquidar(d, c, { ajustes: g.ajustes || [], devuelto: g.devuelto || 0 }),
    };
  }).sort((a, b) => String(b.despido || '').localeCompare(String(a.despido || '')));

  return NextResponse.json({
    filas,
    ultimaCarga: carga.data?.[0] || null,
    avisos,
    puedeEditar: puedeVerSeccion(session.user.role, 'despedidos'),
  }, { headers: SIN_CACHE });
}
