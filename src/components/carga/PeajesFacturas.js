'use client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '@/lib/i18n/useLang';
import { tipoDeArchivo, leerCruce, leerLibro } from '@/lib/peajes/facturas';

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
/** −$8.414 / +$8.414: el signo adelante, no $-8.414. */
const firmado = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${CLP.format(Math.abs(n))}`;
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const ddmmaa = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—');
const DIA = 86400000;
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

async function pedir(url, cuerpo) {
  const r = await fetch(url, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : undefined);
  return r.json().catch(() => ({ error: 'red' }));
}

async function hojasDe(file) {
  const m = await import('xlsx');
  const XLSX = m.read ? m : m.default;
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', dense: true });
  return Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })]));
}

const COLOR_AJUSTE = {
  PROPUESTO: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  APLICADO: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  'NO APLICADO': 'border-gray-600 bg-gray-800 text-gray-300',
};

/**
 * Cruce de peajes contra las facturas de las autopistas: lo calcula el proceso
 * semanal en Python y acá se sube su resultado. Muestra hasta dónde llegan las
 * facturas de cada autopista, qué se cruzó de cada conductor y qué no, y deja a
 * gerencia marcar si cada ajuste se aplicó.
 */
export default function PeajesFacturas() {
  const { t } = useLang();
  const [datos, setDatos] = useState(null);
  const [subida, setSubida] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [buscar, setBuscar] = useState('');
  const [conEx, setConEx] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const input = useRef(null);

  const cargar = useCallback(() => pedir('/api/peajes-facturas').then(setDatos), []);
  useEffect(() => { cargar(); }, [cargar]);

  async function subir(files) {
    const lista = Array.from(files || []);
    if (!lista.length) return;
    setSubida({ paso: 'leyendo' });
    let cruce = null, libro = null;
    try {
      for (const f of lista) {
        const hojas = await hojasDe(f);
        const tipo = tipoDeArchivo(hojas);
        if (tipo === 'cruce') cruce = leerCruce(hojas, f.name);
        if (tipo === 'libro') libro = leerLibro(hojas);
      }
    } catch {
      return setSubida({ paso: 'error', error: 'pf_error_formato' });
    }
    if (!cruce || cruce.error) return setSubida({ paso: 'error', error: 'pf_error_sin_cruce' });
    if (libro?.error) return setSubida({ paso: 'error', error: 'pf_error_libro' });
    setSubida({ paso: 'subiendo' });
    const r = await pedir('/api/peajes-facturas', { accion: 'subir', ...cruce, ajustes: libro?.ajustes || [] });
    if (r.error) return setSubida({ paso: 'error', error: 'pf_error_subir' });
    setSubida({ paso: 'listo', r, sinLibro: !libro });
    cargar();
  }

  async function marcar(id, estado, extra = {}) {
    const r = await pedir('/api/peajes-facturas', { accion: 'marcar', id, estado, ...extra });
    if (r.error) return t('pf_error_marcar');
    await cargar();
    return null;
  }

  const ajustesPor = useMemo(() => {
    const m = new Map();
    for (const a of datos?.ajustes || []) {
      if (!m.has(a.conductor)) m.set(a.conductor, []);
      m.get(a.conductor).push(a);
    }
    return m;
  }, [datos]);

  const filas = useMemo(() => (datos?.cruce || []).map((c) => {
    const ajustes = (ajustesPor.get(c.nombre) || []).sort((a, b) => b.id - a.id);
    const abierto = ajustes.find((a) => a.estado === 'PROPUESTO');
    return { ...c, ajustes, abierto, ultimo: abierto || ajustes.find((a) => a.fecha_corrida === datos.corrida.fecha) || null };
  }), [datos, ajustesPor]);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return filas.filter((f) => {
      if (!conEx && !f.activo) return false;
      if (filtro === 'cruzado' && f.estado !== 'Cruzado') return false;
      if (filtro === 'sin_cruce' && f.estado === 'Cruzado') return false;
      if (filtro === 'por_confirmar' && !f.abierto) return false;
      if (filtro === 'con_accion' && (!f.accion || f.accion === 'Sin accion')) return false;
      if (!q) return true;
      return [f.nombre, f.patentes, f.rut].some((v) => String(v ?? '').toLowerCase().includes(q));
    }).sort((a, b) => Number(!!b.abierto) - Number(!!a.abierto) || (b.cobrado_sin_factura - a.cobrado_sin_factura));
  }, [filas, filtro, buscar, conEx]);

  if (!datos) return <p className="text-sm text-gray-500">…</p>;
  if (datos.error) return <p className="text-sm text-red-400">{t('pg_error_base')}</p>;

  const porConfirmar = (datos.ajustes || []).filter((a) => a.estado === 'PROPUESTO');
  const sumar = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
  const activos = filas.filter((f) => f.activo);

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <div className="space-y-1 text-xs text-gray-400">
          <p>{datos.corrida ? t('pf_corrida')(ddmmaa(datos.corrida.fecha), ddmmaa(datos.corrida.facturas_hasta), datos.corrida.usuario_email) : t('pf_sin_corrida')}</p>
          <p className="text-gray-500">{t('pf_subir_ayuda')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <input ref={input} type="file" multiple accept=".xlsx" className="hidden" onChange={(e) => { subir(e.target.files); e.target.value = ''; }} />
          <button type="button" disabled={subida?.paso === 'leyendo' || subida?.paso === 'subiendo'} onClick={() => input.current?.click()}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-gray-950 hover:bg-sky-400 disabled:opacity-50">
            {t('pf_subir')}
          </button>
          {subida && (
            <p className={`max-w-xs text-right text-xs ${subida.paso === 'error' ? 'text-red-400' : subida.paso === 'listo' ? 'text-emerald-300' : 'text-sky-300'}`}>
              {subida.paso === 'leyendo' && t('pg_leyendo')}
              {subida.paso === 'subiendo' && t('pf_subiendo')}
              {subida.paso === 'listo' && t('pf_listo')(subida.r.conductores, subida.r.facturas, subida.r.ajustesNuevos)}
              {subida.paso === 'listo' && subida.sinLibro && <span className="block text-amber-300">{t('pf_sin_libro')}</span>}
              {subida.paso === 'error' && t(subida.error)}
            </p>
          )}
        </div>
      </section>

      {datos.corrida && (
        <>
          {porConfirmar.length > 0 && (
            <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-100">
              <p className="font-semibold">{t('pf_por_confirmar')(porConfirmar.length, ddmmaa(porConfirmar[0].fecha_corrida))}</p>
              <p className="text-amber-200/80">
                {t('pf_por_confirmar_sub')(CLP.format(sumar(porConfirmar, (a) => Math.max(0, a.monto_propuesto))), CLP.format(sumar(porConfirmar, (a) => Math.max(0, -a.monto_propuesto))))}
                {!datos.puedeMarcar && ` ${t('pf_solo_gerencia')}`}
              </p>
            </section>
          )}

          <Cobertura facturas={datos.facturas} t={t} />

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['pf_card_cruzados', `${activos.filter((f) => f.estado === 'Cruzado').length} / ${activos.length}`, t('pf_card_cruzados_sub'), ''],
              ['pf_card_dif', firmado(sumar(activos, (f) => f.facturado - f.cobrado)), t('pf_card_dif_sub'), ''],
              ['pf_card_sin_factura', CLP.format(sumar(activos, (f) => f.cobrado_sin_factura)), t('pf_card_sin_factura_sub'), 'text-sky-300'],
              ['pf_card_confirmar', String(porConfirmar.length), t('pf_card_confirmar_sub'), porConfirmar.length ? 'text-amber-300' : ''],
            ].map(([k, v, sub, color]) => (
              <div key={k} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
                <p className="text-[11px] text-gray-500">{t(k)}</p>
                <p className={`text-lg font-semibold ${color}`}>{v}</p>
                <p className="text-[11px] text-gray-500">{sub}</p>
              </div>
            ))}
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
              {['', 'por_confirmar', 'con_accion', 'cruzado', 'sin_cruce'].map((k) => <option key={k} value={k}>{t(`pf_filtro_${k || 'todos'}`)}</option>)}
            </select>
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder={t('pg_buscar')}
              className="flex-1 min-w-[12rem] rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={conEx} onChange={(e) => setConEx(e.target.checked)} />
              {t('pf_con_ex')(filas.length - activos.length)}
            </label>
          </section>

          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-500">
                <tr>
                  {['pg_col_conductor', 'pf_col_cruzado', 'pg_col_dif', 'pf_col_sin_factura', 'pf_col_ajuste'].map((k, i) => (
                    <th key={k} className={`px-3 py-2 font-medium whitespace-nowrap ${i === 2 || i === 3 ? 'text-right' : 'text-left'}`}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {visibles.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-gray-500">{t('pg_vacio_filtro')}</td></tr>}
                {visibles.map((f) => {
                  const dif = f.facturado - f.cobrado;
                  const id = f.nombre + (f.activo ? '' : '|ex');
                  return (
                    <Fragment key={id}>
                      <tr className="cursor-pointer align-top hover:bg-gray-900/60" onClick={() => setAbierta(abierta === id ? null : id)}>
                        <td className="px-3 py-1.5">
                          <span className="text-gray-200">{f.nombre}</span>
                          <span className="block font-mono text-[10px] text-gray-500">{f.patentes}{!f.activo && ` · ${t('pf_ex')}`}</span>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {f.estado === 'Cruzado'
                            ? <>{ddmm(f.desde)} – {ddmm(f.hasta)}<span className="block text-[10px] text-gray-500">{t('pf_dias')(f.dias)}</span></>
                            : <span className="text-gray-500">{f.estado === 'Pendiente de factura' ? t('pf_pendiente') : t('pf_sin_cruce')}</span>}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-semibold whitespace-nowrap ${f.estado !== 'Cruzado' || Math.abs(dif) < 100 ? 'text-gray-500' : dif > 0 ? 'text-red-300' : 'text-amber-300'}`}>
                          {f.estado === 'Cruzado' ? firmado(dif) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap text-sky-300" title={f.autopistas_sin_factura || ''}>{f.cobrado_sin_factura ? CLP.format(f.cobrado_sin_factura) : '—'}</td>
                        <td className="min-w-[10rem] px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <Ajuste a={f.ultimo} t={t} puede={datos.puedeMarcar} onMarcar={marcar} />
                        </td>
                      </tr>
                      {abierta === id && (
                        <tr className="bg-gray-950/60">
                          <td colSpan={5} className="space-y-2 px-3 py-2 text-[11px] text-gray-300">
                            {f.estado === 'Cruzado' && <p className="text-gray-200">{t('pf_facturado_cobrado')(CLP.format(f.facturado), CLP.format(f.cobrado), CLP.format(f.pagado))}</p>}
                            {f.motivo && <p>{f.motivo}</p>}
                            {f.autopistas_comparadas && <p className="text-gray-500">{t('pf_comparadas')}: {f.autopistas_comparadas}</p>}
                            {datos.aplicado[f.nombre] ? <p className="text-gray-500">{t('pf_ya_aplicado')(CLP.format(datos.aplicado[f.nombre]))}</p> : null}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Desde cuándo importa tener factura: el inicio del cobro diario de tags. */
const COBERTURA_DESDE = '2026-08-10';

/** Une períodos que se tocan o se pisan, recortados a [desde, hasta]. */
function unir(periodos, desde, hasta) {
  const xs = periodos.filter((p) => p.desde && p.hasta && p.hasta >= desde && p.desde <= hasta)
    .map((p) => [p.desde < desde ? desde : p.desde, p.hasta > hasta ? hasta : p.hasta])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const out = [];
  for (const [d, h] of xs) {
    const ult = out[out.length - 1];
    if (ult && Date.parse(d) - Date.parse(ult[1]) <= DIA) { if (h > ult[1]) ult[1] = h; } else out.push([d, h]);
  }
  return out;
}

/**
 * Hasta dónde llegan las facturas: una línea de tiempo por autopista y grupo de
 * autos, desde el inicio del cobro diario hasta hoy. Verde = hay factura (ya se
 * puede cruzar); gris = falta pedirla.
 */
function Cobertura({ facturas, t }) {
  const hoy = hoyChile();
  const total = Math.max(1, Date.parse(hoy) - Date.parse(COBERTURA_DESDE));
  const pos = (iso) => ((Date.parse(iso) - Date.parse(COBERTURA_DESDE)) / total) * 100;
  const filas = useMemo(() => {
    const por = new Map();
    for (const f of facturas.filter((x) => x.incluida)) {
      const k = `${f.emisor}|${f.grupo || ''}`;
      if (!por.has(k)) por.set(k, { emisor: f.emisor, grupo: String(f.grupo || '').replace(/ \([^)]*\)/g, ''), periodos: [] });
      por.get(k).periodos.push(f);
    }
    return [...por.values()].map((x) => {
      const tramos = unir(x.periodos, COBERTURA_DESDE, hoy);
      const hasta = tramos.length ? tramos[tramos.length - 1][1] : null;
      const folios = [...new Set(x.periodos.map((p) => `${p.folio} (${ddmm(p.desde)}–${ddmm(p.hasta)})`))].join(', ');
      return { ...x, tramos, hasta, folios, falta: hasta ? Math.round((Date.parse(hoy) - Date.parse(hasta)) / DIA) : null };
    }).sort((a, b) => a.emisor.localeCompare(b.emisor) || a.grupo.localeCompare(b.grupo));
  }, [facturas, hoy]);
  const meses = [];
  for (let d = new Date(`${COBERTURA_DESDE.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= hoy; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso >= COBERTURA_DESDE) meses.push(iso);
  }
  const noIncluidas = facturas.filter((f) => !f.incluida);

  return (
    <section className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-200">{t('pf_cobertura')}</h3>
        <p className="text-[11px] text-gray-500">{t('pf_cobertura_ayuda')(ddmm(COBERTURA_DESDE))}</p>
      </div>
      <div className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-x-3 gap-y-2.5 text-xs">
        {filas.map((x) => (
          <Fragment key={`${x.emisor}|${x.grupo}`}>
            <p className="truncate text-gray-200" title={`${x.emisor} · ${x.grupo}`}>{x.emisor} <span className="text-gray-500">{x.grupo}</span></p>
            <div className="relative h-2 rounded-full bg-gray-800" title={`${t('pf_folio')}: ${x.folios}`}>
              {x.tramos.map(([d, h]) => (
                <span key={d} className="absolute inset-y-0 rounded-full bg-emerald-500/80"
                  style={{ left: `${pos(d)}%`, width: `${Math.max(0.8, pos(h) - pos(d) + 100 / (total / DIA))}%` }} />
              ))}
            </div>
            <p className="text-right whitespace-nowrap">
              <span className="text-gray-300">{ddmm(x.hasta)}</span>
              <span className={`block text-[10px] ${x.falta > 35 ? 'text-red-300' : 'text-gray-500'}`}>{t('pf_faltan')(x.falta)}</span>
            </p>
          </Fragment>
        ))}
        <span />
        <div className="relative h-3 text-[10px] text-gray-500">
          {meses.map((m) => <span key={m} className="absolute -translate-x-1/2" style={{ left: `${pos(m)}%` }}>{t('pg_meses')[Number(m.slice(5, 7)) - 1]}</span>)}
        </div>
        <span />
      </div>
      {noIncluidas.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-400">{t('pf_no_incluidas')(noIncluidas.length)}</summary>
          <ul className="mt-2 space-y-1 text-gray-400">
            {noIncluidas.map((f, i) => (
              <li key={i}><span className="text-gray-200">{f.emisor} {f.folio}</span> · {ddmmaa(f.desde)} – {ddmmaa(f.hasta)}{f.monto ? ` · ${CLP.format(f.monto)}` : ''} — {f.motivo}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Ajuste({ a, t, puede, onMarcar }) {
  const [editando, setEditando] = useState(false);
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  if (!a) return <span className="text-gray-600">—</span>;

  const accion = async (estado, extra) => {
    setGuardando(true);
    const e = await onMarcar(a.id, estado, extra);
    setGuardando(false);
    setError(e);
    if (!e) setEditando(false);
  };
  const etiqueta = a.estado.startsWith('REEMPLAZADO') ? 'pf_reemplazado' : a.estado.startsWith('ANULADO') ? 'pf_anulado' : `pf_estado_${a.estado.replace(' ', '_').toLowerCase()}`;
  const color = COLOR_AJUSTE[a.estado] || 'border-gray-700 text-gray-400';

  return (
    <div className="space-y-1">
      <p className="whitespace-nowrap">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${color}`}>{t(etiqueta)}</span>
      </p>
      <p className="text-[10px] text-gray-500">
        <span className={`text-xs font-semibold ${a.monto_propuesto > 0 ? 'text-red-300' : 'text-amber-300'}`}>{firmado(a.monto_propuesto || 0)}</span>
        {a.accion ? ` · ${t(`pf_accion_${a.accion.replace(/ /g, '_').toLowerCase()}`)}` : ''}
        {a.estado === 'APLICADO' && ` · ${CLP.format(a.monto_aplicado || 0)}${a.referencia ? ` · ${a.referencia}` : ''}`}
        {a.marcado_por && ` · ${a.marcado_por}`}
      </p>
      {puede && a.estado === 'PROPUESTO' && !editando && (
        <div className="flex gap-1.5">
          <button type="button" disabled={guardando} onClick={() => { setMonto(String(a.monto_propuesto ?? '')); setEditando(true); }}
            className="whitespace-nowrap rounded bg-emerald-500/90 px-2 py-0.5 text-[11px] font-semibold text-gray-950 hover:bg-emerald-400">{t('pf_btn_aplicado')}</button>
          <button type="button" disabled={guardando} onClick={() => accion('NO APLICADO')}
            className="whitespace-nowrap rounded border border-gray-600 px-2 py-0.5 text-[11px] text-gray-300 hover:bg-gray-800">{t('pf_btn_no_aplicado')}</button>
        </div>
      )}
      {puede && editando && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d-]/g, ''))} aria-label={t('pf_monto_aplicado')}
            className="w-24 rounded border border-sky-500/60 bg-gray-950 px-2 py-0.5 text-right" />
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder={t('pf_referencia')}
            className="w-40 rounded border border-gray-700 bg-gray-950 px-2 py-0.5" />
          <button type="button" disabled={guardando || !/^-?\d+$/.test(monto)} onClick={() => accion('APLICADO', { monto: Number(monto), referencia })}
            className="rounded bg-sky-500 px-2 py-0.5 text-[11px] font-semibold text-gray-950 disabled:opacity-50">{t('ma_guardar')}</button>
          <button type="button" onClick={() => setEditando(false)} className="px-1 text-[11px] text-gray-400 hover:text-white">{t('ma_cancelar')}</button>
        </div>
      )}
      {puede && a.marcado_en && ['APLICADO', 'NO APLICADO'].includes(a.estado) && (
        <button type="button" disabled={guardando} onClick={() => accion('PROPUESTO')} className="text-[10px] text-gray-500 underline hover:text-gray-300">
          {t('pf_btn_deshacer')}
        </button>
      )}
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
