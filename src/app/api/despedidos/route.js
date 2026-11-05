export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { supabaseServidor } from '@/lib/supabase/server';
import { reporteDesdeSupabase as billsDesdeSupabase } from '@/lib/bills/supabase';
import { reporteDesdeSupabase as multasDesdeSupabase } from '@/lib/multas/supabase';
import { liquidar, asignarPorNombre, rentaAlDespido, aplicarCambios, enChile, enmascararCuenta } from '@/lib/fleet/despedidos';
import { rentaDeAuto } from '@/lib/fleet/renta';
import { normalizarNombre } from '@/lib/fleet/nombres';
import { google } from 'googleapis';
import { leerFilaDevolucion, asignarDevoluciones } from '@/lib/fleet/devoluciones';

const CONTROL_FLOTA = '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw';
const HOJA_DEVOLUCIONES = 'Devoluciones de Garantia';

/** Filas de la hoja de devoluciones con su color: el verde dice que ya se devolvió. */
async function leerDevoluciones() {
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const r = await google.sheets({ version: 'v4', auth }).spreadsheets.get({
    spreadsheetId: CONTROL_FLOTA,
    ranges: [`'${HOJA_DEVOLUCIONES}'!A:D`],
    includeGridData: true,
    fields: 'sheets(data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))',
  });
  const filas = r.data.sheets?.[0]?.data?.[0]?.rowData || [];
  return filas.map((f, i) => {
    const vs = f.values || [];
    return leerFilaDevolucion([0, 1, 2, 3].map((j) => vs[j]?.formattedValue ?? ''), vs[0]?.effectiveFormat?.backgroundColor, i + 1);
  }).filter(Boolean);
}

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
  const [desp, gest, carga, camb, autos] = await Promise.all([
    sb.from('despedidos').select('clave, rut, nombre, nombre_fleet, telefono, activacion, despido, balance, garantia, comentario, actualizado'),
    sb.from('despedidos_gestion').select('*'),
    sb.from('cargas').select('archivo, creado, usuario_email').eq('tipo', 'despedidos').eq('aplicada', true)
      .order('creado', { ascending: false }).limit(1),
    sb.from('despedidos_cambios').select('*').order('propuesto_en'),
    sb.from('autos').select('patente, marca, modelo'),
  ]);
  if (faltaMigracion(desp.error) || faltaMigracion(gest.error)) {
    return NextResponse.json({ error: 'sin_migracion' }, { status: 503, headers: SIN_CACHE });
  }
  if (desp.error || gest.error) return NextResponse.json({ error: 'base' }, { status: 500 });

  const despedidos = desp.data.map((d) => ({ ...d, nombreFleet: d.nombre_fleet }));
  const ultimoActivo = await ultimosBalances(sb, despedidos);
  const marcas = new Map((autos.data || []).map((a) => [a.patente, a]));
  const cambiosDe = new Map();
  for (const c of camb.data || []) {
    if (!cambiosDe.has(c.clave)) cambiosDe.set(c.clave, []);
    cambiosDe.get(c.clave).push(c);
  }
  const cobros = new Map(despedidos.map((d) => [d.clave, { tags: 0, otros: 0, multas: 0, nTags: 0, nOtros: 0, nMultas: 0 }]));

  // Mismas fuentes que el reporte de deudas. Si una falla, se muestra igual
  // con lo que haya y se avisa cuál faltó.
  const avisos = [];
  const [bills, multas, devoluciones] = await Promise.all([
    billsDesdeSupabase().catch((e) => { console.error('despedidos bills', e.message); avisos.push('bills'); return { bills: [] }; }),
    multasDesdeSupabase().catch((e) => { console.error('despedidos multas', e.message); avisos.push('multas'); return { fines: [] }; }),
    leerDevoluciones().catch((e) => { console.error('despedidos devoluciones', e.message); avisos.push('devoluciones'); return []; }),
  ]);
  const { porClave: devPorClave, sinAsignar: devSinAsignar } = asignarDevoluciones(devoluciones, despedidos);
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
    const devs = devPorClave.get(d.clave) || [];
    const enviado = devs.filter((x) => x.devuelta).reduce((s, x) => s + x.monto, 0);
    const pendienteCF = devs.filter((x) => !x.devuelta).reduce((s, x) => s + x.monto, 0);

    // Renta al despido: del último export en que estaba activo, como PLAZO
    const ultimo = ultimoActivo.get(d.clave) || null;
    const auto = ultimo?.patente ? marcas.get(ultimo.patente) : null;
    const semanal = auto ? rentaDeAuto(auto.marca, auto.modelo)?.monto ?? null : null;
    const renta = ultimo
      ? { ...rentaAlDespido(ultimo, semanal, d.despido), ultimoBalance: ultimo.balance, ultimoFecha: ultimo.fecha, patente: ultimo.patente, semanal }
      : { ...rentaAlDespido({ balance: d.balance, fecha: null }, null, d.despido), sinHistorial: true };

    // Casillas: lo calculado, con las correcciones aprobadas encima
    const base = {
      renta: renta.neta, tags: Math.round(c.tags), multas: Math.round(c.multas), otros: Math.round(c.otros),
      garantia: d.garantia || 0, ajustes: (g.ajustes || []).reduce((a, x) => a + (Number(x.monto) || 0), 0),
    };
    const { valores, corregido, pendientes } = aplicarCambios(base, cambiosDe.get(d.clave) || []);
    const devueltoAhora = g.cerrado && g.cerrado_tipo === 'devuelto' ? g.cerrado_monto || 0 : 0;
    const liq = liquidar(
      { balance: -valores.renta, garantia: valores.garantia },
      { tags: valores.tags, multas: valores.multas, otros: valores.otros },
      { ajustes: [{ monto: valores.ajustes }], devuelto: (g.devuelto || 0) + enviado + devueltoAhora },
    );
    // Con la devolución hecha en Control Flota la garantía queda liquidada: se
    // devolvió lo que se calculó en su momento, aunque la cuenta de hoy dé otro
    // número (una multa que llegó después, un tag que se pagó). La diferencia se
    // muestra, pero no queda como algo por devolver.
    if (enviado > 0) { liq.devolverCalculado = liq.devolver; liq.devolver = 0; }
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
      renta,
      base,
      valores,
      corregido,
      pendientes,
      historial: (cambiosDe.get(d.clave) || []).map((x) => ({ id: x.id, campo: x.campo, valor: x.valor, anterior: x.anterior, nota: x.nota, estado: x.estado, por: x.propuesto_por, en: x.propuesto_en, revisadoPor: x.revisado_por })),
      gestion: {
        ajustes: g.ajustes || [],
        devuelto: g.devuelto || 0,
        devueltoFecha: g.devuelto_fecha || null,
        anexoDicom: !!g.anexo_dicom,
        anexoPor: g.anexo_por || null,
        anexoFecha: g.anexo_fecha || null,
        nota: g.nota || '',
        listo: !!g.listo,
        listoPor: g.listo_por || null,
        listoEn: g.listo_en || null,
        cerrado: !!g.cerrado,
        cerradoTipo: g.cerrado_tipo || null,
        cerradoMonto: g.cerrado_monto || 0,
        cerradoPor: g.cerrado_por || null,
        cerradoEn: g.cerrado_en || null,
        // La cuenta completa solo la ve gerencia, que es quien transfiere
        cuenta: g.cuenta ? (session.user.isManager ? g.cuenta : enmascararCuenta(g.cuenta)) : null,
        cuentaPor: g.cuenta_por || null,
        cuentaEn: g.cuenta_en || null,
        actualizadoPor: g.actualizado_por || null,
        actualizado: g.actualizado || null,
      },
      devoluciones: devs.map(({ cuenta, ...x }) => x), // sin la cuenta bancaria
      devolucionEnviada: enviado,
      devolucionPendiente: pendienteCF,
      liquidacion: liq,
    };
  }).sort((a, b) => String(b.despido || '').localeCompare(String(a.despido || '')));

  return NextResponse.json({
    filas,
    ultimaCarga: carga.data?.[0] || null,
    devolucionesSinAsignar: devSinAsignar.map((x) => ({ fila: x.fila, nombre: x.nombre, monto: x.monto, devuelta: x.devuelta })),
    avisos,
    puedeEditar: puedeVerSeccion(session.user.role, 'despedidos'),
    puedeAprobar: !!session.user.isManager,
  }, { headers: SIN_CACHE });
}

/**
 * El último Balance de cada despedido mientras estaba activo: el del último
 * export de conductores subido hasta el día de su despido (ese día incluido).
 * Se busca por RUT y, si no tiene, por nombre.
 */
async function ultimosBalances(sb, despedidos) {
  const ruts = despedidos.map((d) => d.rut).filter(Boolean);
  const nombres = despedidos.filter((d) => !d.rut).flatMap((d) => [d.nombre, d.nombre_fleet]).filter(Boolean).map(normalizarNombre);
  const filas = [];
  for (const [col, lista] of [['rut', ruts], ['clave_nombre', nombres]]) {
    if (!lista.length) continue;
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb.from('conductores_balances').select('rut, clave_nombre, patente, balance, fecha')
        .in(col, lista).order('fecha').order('id').range(desde, desde + 999);
      if (error) { if (!faltaMigracion(error)) console.error('despedidos balances', error.message); return new Map(); }
      filas.push(...data);
      if (data.length < 1000) break;
    }
  }
  const out = new Map();
  for (const d of despedidos) {
    const nombresD = new Set([d.nombre, d.nombre_fleet].filter(Boolean).map(normalizarNombre));
    const suyas = filas.filter((f) => (d.rut ? f.rut === d.rut : nombresD.has(f.clave_nombre)))
      .filter((f) => !d.despido || enChile(f.fecha).fecha <= d.despido);
    if (suyas.length) out.set(d.clave, suyas[suyas.length - 1]);
  }
  return out;
}
