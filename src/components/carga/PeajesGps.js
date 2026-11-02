'use client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '@/lib/i18n/useLang';
import { leerPasadas } from '@/lib/peajes/gps';
import { estadoDe } from '@/lib/peajes/comparar';

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('es-CL');
const LOTE = 4000;

async function pedir(url, cuerpo) {
  const r = await fetch(url, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : undefined);
  return r.json().catch(() => ({ error: 'red' }));
}

async function xlsx() {
  const m = await import('xlsx');
  return m.read ? m : m.default;
}

const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const COLOR_ESTADO = { falta: 'text-red-300 bg-red-500/10 border-red-500/30', demas: 'text-amber-300 bg-amber-500/10 border-amber-500/30', ok: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' };

function haceCuanto(iso, t) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return t('carga_hace_min')(min);
  if (min < 48 * 60) return t('carga_hace_h')(Math.round(min / 60));
  return t('carga_hace_d')(Math.round(min / 1440));
}

/** Junta las semanas de cada conductor en una fila, para ver todo el período. */
function juntarPeriodo(filas) {
  const por = new Map();
  for (const f of filas) {
    const x = por.get(f.clave) || { ...f, bloque: 'todo', gps: 0, pasadas: 0, fleet: 0, cruces: 0, dias: [], patentes: [] };
    x.gps += f.gps; x.pasadas += f.pasadas; x.fleet += f.fleet; x.cruces += f.cruces;
    x.dias = x.dias.concat(f.dias);
    x.patentes = [...new Set(x.patentes.concat(f.patentes))];
    por.set(f.clave, x);
  }
  return [...por.values()].map((x) => ({
    ...x, dif: x.gps - x.fleet, estado: estadoDe(x.gps, x.fleet),
    dias: x.dias.sort((a, b) => a.dia.localeCompare(b.dia) || a.patente.localeCompare(b.patente)),
  })).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
}

/**
 * Peajes GPS vs Fleet: sube el Listado de TAGs del GPS y muestra, por conductor
 * y semana de cobro, lo que registró el GPS contra lo que Fleet le cargó.
 */
export default function PeajesGps() {
  const { t } = useLang();
  const [datos, setDatos] = useState(null);
  const [subida, setSubida] = useState(null); // { paso, hechas, total, nuevas, error }
  const [bloque, setBloque] = useState(null);
  const [encargado, setEncargado] = useState('');
  const [estado, setEstado] = useState('');
  const [buscar, setBuscar] = useState('');
  const [abierta, setAbierta] = useState(null);
  const input = useRef(null);

  const cargar = useCallback(() => pedir('/api/peajes-gps').then((d) => {
    setDatos(d);
    // Por defecto, la última semana de cobro completa
    setBloque((b) => b ?? (d.bloques?.find((x) => x.completo) || d.bloques?.[0])?.bloque ?? 'todo');
  }), []);
  useEffect(() => { cargar(); }, [cargar]);

  async function subir(file) {
    if (!file) return;
    setSubida({ paso: 'leyendo' });
    let leido;
    try {
      const XLSX = await xlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', dense: true });
      leido = leerPasadas(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }));
    } catch {
      return setSubida({ paso: 'error', error: 'pg_error_formato' });
    }
    if (leido.error) return setSubida({ paso: 'error', error: 'pg_error_formato' });
    if (!leido.pasadas.length) return setSubida({ paso: 'error', error: 'pg_error_vacio' });

    const total = leido.pasadas.length;
    const inicio = await pedir('/api/peajes-gps', { accion: 'iniciar', archivo: file.name, filas: total, desde: leido.desde, hasta: leido.hasta });
    if (inicio.error) return setSubida({ paso: 'error', error: 'pg_error_subir' });
    let nuevas = 0;
    for (let i = 0; i < total; i += LOTE) {
      setSubida({ paso: 'subiendo', hechas: i, total, nuevas });
      const r = await pedir('/api/peajes-gps', { accion: 'lote', cargaId: inicio.cargaId, pasadas: leido.pasadas.slice(i, i + LOTE) });
      if (r.error) return setSubida({ paso: 'error', error: 'pg_error_subir' });
      nuevas += r.nuevas;
    }
    const fin = await pedir('/api/peajes-gps', { accion: 'cerrar', cargaId: inicio.cargaId });
    setSubida({ paso: 'listo', total, nuevas: fin.error ? nuevas : fin.nuevas });
    cargar();
  }

  const filas = datos?.filas || [];
  const encargados = useMemo(() => [...new Set(filas.map((f) => f.encargado).filter(Boolean))].sort(), [filas]);
  const enVista = useMemo(() => (bloque === 'todo' ? juntarPeriodo(filas) : filas.filter((f) => f.bloque === bloque)), [filas, bloque]);
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return enVista.filter((f) => {
      if (encargado && f.encargado !== encargado) return false;
      if (estado && f.estado !== estado) return false;
      if (!q) return true;
      return [f.conductor, ...f.patentes].some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [enVista, buscar, encargado, estado]);

  const totales = useMemo(() => visibles.reduce((s, f) => {
    s.gps += f.gps; s.fleet += f.fleet;
    if (f.estado === 'falta') { s.falta += f.dif; s.nFalta++; }
    if (f.estado === 'demas') { s.demas -= f.dif; s.nDemas++; }
    return s;
  }, { gps: 0, fleet: 0, falta: 0, demas: 0, nFalta: 0, nDemas: 0 }), [visibles]);

  async function exportar() {
    const XLSX = await xlsx();
    const nombre = (f) => f.conductor || t('pg_sin_conductor');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visibles.map((f) => ({
      [t('pg_col_conductor')]: nombre(f), [t('ma_col_encargado')]: f.encargado || '', [t('pg_col_autos')]: f.patentes.join(', '),
      [t('pg_col_gps')]: f.gps, [`${t('pg_col_gps')} #`]: f.pasadas, [t('pg_col_fleet')]: f.fleet, [`${t('pg_col_fleet')} #`]: f.cruces,
      [t('pg_col_dif')]: f.dif, [t('pg_col_estado')]: t(`pg_estado_${f.estado}`),
    }))), t('pg_hoja_conductores'));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visibles.flatMap((f) => f.dias.map((d) => ({
      [t('pg_col_conductor')]: nombre(f), [t('pg_col_dia')]: d.dia, [t('ma_col_patente')]: d.patente,
      [t('pg_col_gps')]: d.gps, [`${t('pg_col_gps')} #`]: d.pasadas, [t('pg_col_fleet')]: d.fleet, [`${t('pg_col_fleet')} #`]: d.cruces,
      [t('pg_col_dif')]: d.gps - d.fleet, [t('pg_col_nota')]: d.nota ? t(`pg_nota_${d.nota}`) : '', Bills: d.bills.join(', '),
    })))), t('pg_hoja_dias'));
    XLSX.writeFile(wb, `Peajes GPS vs Fleet - ${bloque === 'todo' ? 'todo' : bloque}.xlsx`);
  }

  if (!datos) return <p className="text-sm text-gray-500">…</p>;
  if (datos.error) return <p className="text-sm text-red-400">{t('pg_error_base')}</p>;

  const sinBills = datos.diasSinBills || [];
  const ocupado = subida && ['leyendo', 'subiendo'].includes(subida.paso);

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <div className="space-y-1 text-xs text-gray-400">
          <p>{datos.cargaGps ? t('pg_ultima_gps')(datos.cargaGps.archivo, String(datos.cargaGps.hasta).slice(0, 16).replace('T', ' '), haceCuanto(datos.cargaGps.creado, t)) : t('pg_sin_gps')}</p>
          {datos.cargaBills && <p>{t('pg_ultima_bills')(haceCuanto(datos.cargaBills.creado, t))}</p>}
          <p className="text-gray-500">{t('pg_subir_ayuda')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" disabled={ocupado} onClick={() => input.current?.click()}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-gray-950 hover:bg-sky-400 disabled:opacity-50">
            {t('pg_subir')}
          </button>
          {subida && (
            <p className={`text-xs ${subida.paso === 'error' ? 'text-red-400' : subida.paso === 'listo' ? 'text-emerald-300' : 'text-sky-300'}`}>
              {subida.paso === 'leyendo' && t('pg_leyendo')}
              {subida.paso === 'subiendo' && t('pg_subiendo')(NUM.format(subida.hechas), NUM.format(subida.total), NUM.format(subida.nuevas))}
              {subida.paso === 'listo' && t('pg_listo')(NUM.format(subida.nuevas), NUM.format(subida.total))}
              {subida.paso === 'error' && t(subida.error)}
            </p>
          )}
        </div>
      </section>

      {!filas.length ? <p className="text-sm text-gray-500">{t('pg_sin_gps')}</p> : (
        <>
          <p className="text-xs text-gray-500">{t('pg_compara')(ddmm(datos.desde), ddmm(datos.hasta))} {t('pg_ayuda')}</p>

          {sinBills.length > 0 && (
            <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200">
              <p className="mb-1 font-semibold">{t('pg_dias_sin_bills')(sinBills.length, CLP.format(sinBills.reduce((s, d) => s + d.gps, 0)))}</p>
              <p className="text-red-300/80">{sinBills.map((d) => `${t('pg_dias')[new Date(`${d.dia}T00:00:00Z`).getUTCDay()]} ${ddmm(d.dia)} (${CLP.format(d.gps)})`).join(' · ')}</p>
            </section>
          )}

          <section className="flex flex-wrap gap-2">
            <select value={bloque || 'todo'} onChange={(e) => { setBloque(e.target.value); setAbierta(null); }}
              className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm" aria-label={t('pg_semana')}>
              {datos.bloques.map((b) => <option key={b.bloque} value={b.bloque}>{t('pg_bloque')(ddmm(b.bloque), ddmm(b.lunes), ddmm(b.domingo), b.completo)}</option>)}
              <option value="todo">{t('pg_todo')}</option>
            </select>
            <select value={encargado} onChange={(e) => setEncargado(e.target.value)} className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
              <option value="">{t('ma_todos_encargados')}</option>
              {encargados.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
              <option value="">{t('pg_todos_estados')}</option>
              {['falta', 'demas', 'ok'].map((e) => <option key={e} value={e}>{t(`pg_estado_${e}`)}</option>)}
            </select>
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder={t('pg_buscar')}
              className="flex-1 min-w-[12rem] rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm" />
            <button type="button" onClick={exportar} className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">
              {t('pg_exportar')}
            </button>
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['pg_card_gps', CLP.format(totales.gps), null, ''],
              ['pg_card_fleet', CLP.format(totales.fleet), null, ''],
              ['pg_card_falta', CLP.format(totales.falta), t('pg_conductores')(totales.nFalta), 'text-red-300'],
              ['pg_card_demas', CLP.format(totales.demas), t('pg_conductores')(totales.nDemas), 'text-amber-300'],
            ].map(([k, v, sub, color]) => (
              <div key={k} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
                <p className="text-[11px] text-gray-500">{t(k)}</p>
                <p className={`text-lg font-semibold ${color}`}>{v}</p>
                {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
              </div>
            ))}
          </section>

          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-500">
                <tr>
                  {['pg_col_conductor', 'pg_col_autos', 'pg_col_gps', 'pg_col_fleet', 'pg_col_dif', 'pg_col_estado'].map((k, i) => (
                    <th key={k} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {visibles.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-gray-500">{t('pg_vacio_filtro')}</td></tr>}
                {visibles.map((f) => {
                  const id = `${f.clave}|${f.bloque}`;
                  return (
                    <Fragment key={id}>
                      <tr className="cursor-pointer hover:bg-gray-900/60" onClick={() => setAbierta(abierta === id ? null : id)}>
                        <td className="px-3 py-1.5">
                          <span className={f.conductor ? 'text-gray-200' : 'text-gray-500'}>{f.conductor || t('pg_sin_conductor')}</span>
                          {f.encargado && <span className="block text-[10px] text-gray-500">{f.encargado}</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-gray-300">{f.patentes.join(' · ')}</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">{CLP.format(f.gps)}<span className="block text-[10px] text-gray-500">{t('pg_pasadas')(f.pasadas)}</span></td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">{CLP.format(f.fleet)}<span className="block text-[10px] text-gray-500">{t('pg_pasadas')(f.cruces)}</span></td>
                        <td className={`px-3 py-1.5 text-right font-semibold whitespace-nowrap ${f.estado === 'falta' ? 'text-red-300' : f.estado === 'demas' ? 'text-amber-300' : 'text-gray-400'}`}>
                          {f.dif > 0 ? '+' : ''}{CLP.format(f.dif)}
                        </td>
                        <td className="px-3 py-1.5"><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${COLOR_ESTADO[f.estado]}`}>{t(`pg_estado_${f.estado}`)}</span></td>
                      </tr>
                      {abierta === id && (
                        <tr className="bg-gray-950/60">
                          <td colSpan={6} className="px-3 py-2"><DetalleDias dias={f.dias} t={t} /></td>
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

function DetalleDias({ dias, t }) {
  return (
    <table className="w-full text-[11px]">
      <thead className="text-gray-500">
        <tr>
          <th className="px-2 py-1 text-left font-medium">{t('pg_col_dia')}</th>
          <th className="px-2 py-1 text-left font-medium">{t('ma_col_patente')}</th>
          <th className="px-2 py-1 text-right font-medium">{t('pg_col_gps')}</th>
          <th className="px-2 py-1 text-right font-medium">{t('pg_col_fleet')}</th>
          <th className="px-2 py-1 text-right font-medium">{t('pg_col_dif')}</th>
          <th className="px-2 py-1 text-left font-medium">{t('pg_col_nota')}</th>
        </tr>
      </thead>
      <tbody>
        {dias.map((d) => {
          const dif = d.gps - d.fleet;
          const fuera = estadoDe(d.gps, d.fleet) !== 'ok';
          return (
            <tr key={`${d.dia}|${d.patente}`} className={fuera ? 'text-gray-100' : 'text-gray-500'}>
              <td className="px-2 py-0.5 whitespace-nowrap">{t('pg_dias')[new Date(`${d.dia}T00:00:00Z`).getUTCDay()]} {ddmm(d.dia)}</td>
              <td className="px-2 py-0.5 font-mono">{d.patente}</td>
              <td className="px-2 py-0.5 text-right whitespace-nowrap">{CLP.format(d.gps)} <span className="text-gray-500">({d.pasadas})</span></td>
              <td className="px-2 py-0.5 text-right whitespace-nowrap">{CLP.format(d.fleet)} <span className="text-gray-500">({d.cruces})</span></td>
              <td className={`px-2 py-0.5 text-right whitespace-nowrap ${fuera ? (dif > 0 ? 'text-red-300' : 'text-amber-300') : ''}`}>{dif > 0 ? '+' : ''}{CLP.format(dif)}</td>
              <td className="px-2 py-0.5">{d.nota ? t(`pg_nota_${d.nota}`) : <span className="text-gray-600">{d.bills.join(', ')}</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
