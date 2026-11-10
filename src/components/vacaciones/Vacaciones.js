'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n/useLang';
import { diasHabiles, diasHabilesEnAnio, cruces, vigente, semanasDelMes, esHabil, FERIADOS } from '@/lib/vacaciones';

const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const primerNombre = (n) => String(n || '').split(/\s+/)[0];
// Un color fijo por persona (orden alfabético del correo), para reconocerla en el calendario
const COLORES = ['bg-sky-500/80', 'bg-emerald-500/80', 'bg-violet-500/80', 'bg-rose-500/80', 'bg-teal-500/80', 'bg-fuchsia-500/80', 'bg-indigo-500/80', 'bg-lime-600/80', 'bg-orange-500/80', 'bg-cyan-600/80'];

async function pedir(url, cuerpo) {
  const r = await fetch(url, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : { cache: 'no-store' });
  return r.json().catch(() => ({ error: 'red' }));
}

/**
 * Vacaciones del equipo: cada uno pide las suyas, gerencia aprueba las de los
 * coordinadores (las propias quedan aprobadas) y todos ven el calendario.
 */
export default function Vacaciones() {
  const { t } = useLang();
  const [datos, setDatos] = useState(null);
  const [mes, setMes] = useState(null); // [año, mes]
  const cargar = useCallback(() => pedir('/api/vacaciones').then((d) => {
    setDatos(d);
    setMes((m) => m || (d.hoy ? [Number(d.hoy.slice(0, 4)), Number(d.hoy.slice(5, 7))] : null));
  }), []);
  useEffect(() => { cargar(); }, [cargar]);

  const lista = useMemo(() => datos?.vacaciones || [], [datos]);
  const colorDe = useMemo(() => {
    const emails = [...new Set(lista.map((v) => String(v.usuario_email).toLowerCase()))].sort();
    return (email) => COLORES[emails.indexOf(String(email).toLowerCase()) % COLORES.length] || COLORES[0];
  }, [lista]);

  if (!datos) return <p className="text-sm text-gray-400">…</p>;
  if (datos.error === 'sin_migracion') return <p className="text-sm text-amber-400">{t('vc_sin_migracion')}</p>;
  if (datos.error) return <p className="text-sm text-red-400">{t('vc_error_cargar')}</p>;

  const accion = async (cuerpo) => {
    const r = await pedir('/api/vacaciones', cuerpo);
    if (r.error) return t(`vc_error_${r.error}`) === `vc_error_${r.error}` ? t('vc_error_guardar') : t(`vc_error_${r.error}`);
    await cargar();
    return null;
  };
  const porAprobar = lista.filter((v) => v.estado === 'solicitada');
  const proximas = lista.filter((v) => vigente(v) && v.hasta >= datos.hoy);

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">{datos.puedeAprobar ? t('vc_ayuda_gerencia') : t('vc_ayuda')}</p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-4">
          <Solicitar t={t} lista={lista} datos={datos} onAccion={accion} />
          {datos.puedeAprobar && porAprobar.length > 0 && <PorAprobar t={t} lista={lista} porAprobar={porAprobar} onAccion={accion} />}
        </div>
        {mes && <Calendario t={t} lista={lista} mes={mes} setMes={setMes} hoy={datos.hoy} colorDe={colorDe} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,20rem)]">
        <Proximas t={t} proximas={proximas} datos={datos} colorDe={colorDe} onAccion={accion} />
        <Totales t={t} lista={lista} hoy={datos.hoy} colorDe={colorDe} />
      </div>
    </div>
  );
}

function Tarjeta({ titulo, children }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <p className="mb-3 text-[11px] uppercase tracking-wider text-gray-500">{titulo}</p>
      {children}
    </section>
  );
}

function Solicitar({ t, lista, datos, onAccion }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const dias = desde && hasta ? diasHabiles(desde, hasta) : 0;
  const cruza = desde && hasta && hasta >= desde ? cruces(lista, desde, hasta, datos.yo.email) : [];
  const campo = 'w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm outline-none focus:border-sky-500';

  async function enviar() {
    setOcupado(true);
    const e = await onAccion({ accion: 'solicitar', desde, hasta, nota });
    setOcupado(false);
    setError(e);
    if (!e) { setOk(datos.puedeAprobar ? t('vc_ok_aprobada') : `${t('vc_ok_solicitada')}. ${t('vc_solo_gerencia')}`); setDesde(''); setHasta(''); setNota(''); }
  }

  return (
    <Tarjeta titulo={datos.puedeAprobar ? t('vc_agregar_titulo') : t('vc_pedir_titulo')}>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">{t('vc_desde')}
          <input type="date" min={datos.hoy} value={desde} onChange={(e) => { setDesde(e.target.value); setOk(null); if (!hasta || e.target.value > hasta) setHasta(e.target.value); }} className={campo} />
        </label>
        <label className="text-xs text-gray-400">{t('vc_hasta')}
          <input type="date" min={desde || datos.hoy} value={hasta} onChange={(e) => { setHasta(e.target.value); setOk(null); }} className={campo} />
        </label>
        <input placeholder={t('vc_nota')} value={nota} onChange={(e) => setNota(e.target.value)} className={`${campo} col-span-2`} />
      </div>
      {desde && hasta && (
        <p className="mt-2 text-sm text-gray-200">{t('vc_dias_habiles')(dias)}</p>
      )}
      {cruza.length > 0 && (
        <p className="mt-1 text-xs text-amber-300">⚠ {t('vc_se_cruza')} {cruza.map((v) => `${v.nombre} (${ddmm(v.desde)}–${ddmm(v.hasta)}${v.estado === 'solicitada' ? `, ${t('vc_estado_solicitada')}` : ''})`).join(' · ')}</p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={ocupado || !dias} onClick={enviar}
          className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-gray-950 hover:bg-sky-400 disabled:opacity-50">
          {datos.puedeAprobar ? t('vc_btn_agregar') : t('vc_btn_pedir')}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
        {ok && <span className="text-xs text-emerald-300">{ok}</span>}
      </div>
    </Tarjeta>
  );
}

function PorAprobar({ t, lista, porAprobar, onAccion }) {
  const [ocupado, setOcupado] = useState(null);
  const revisar = async (v, aprobar) => {
    const motivo = aprobar ? null : window.prompt(t('vc_motivo_rechazo'), '');
    if (!aprobar && motivo === null) return;
    setOcupado(v.id);
    const e = await onAccion({ accion: 'revisar', id: v.id, aprobar, motivo });
    setOcupado(null);
    if (e) alert(e);
  };
  return (
    <Tarjeta titulo={`${t('vc_por_aprobar')} (${porAprobar.length})`}>
      <ul className="space-y-3">
        {porAprobar.map((v) => {
          const cruza = cruces(lista, v.desde, v.hasta, v.usuario_email);
          return (
            <li key={v.id} className="text-sm">
              <p className="text-gray-100">{v.nombre}</p>
              <p className="text-xs text-gray-400">{ddmm(v.desde)} – {ddmm(v.hasta)} · {t('vc_dias_habiles')(v.dias)}{v.nota ? ` · ${v.nota}` : ''}</p>
              {cruza.length > 0 && <p className="text-[11px] text-amber-300">⚠ {t('vc_se_cruza')} {cruza.map((x) => x.nombre).join(', ')}</p>}
              <div className="mt-1 flex gap-2">
                <button type="button" disabled={ocupado === v.id} onClick={() => revisar(v, true)}
                  className="rounded bg-emerald-500/90 px-2 py-0.5 text-[11px] font-semibold text-gray-950 hover:bg-emerald-400">✓ {t('vc_aprobar')}</button>
                <button type="button" disabled={ocupado === v.id} onClick={() => revisar(v, false)}
                  className="rounded border border-gray-600 px-2 py-0.5 text-[11px] text-gray-300 hover:bg-gray-800">✕ {t('vc_rechazar')}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </Tarjeta>
  );
}

function Calendario({ t, lista, mes, setMes, hoy, colorDe }) {
  const [anio, m] = mes;
  const semanas = semanasDelMes(anio, m);
  const mover = (d) => { const x = new Date(Date.UTC(anio, m - 1 + d, 1)); setMes([x.getUTCFullYear(), x.getUTCMonth() + 1]); };
  const vig = lista.filter(vigente);
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => mover(-1)} className="rounded px-2 text-gray-400 hover:text-white" aria-label={t('vc_mes_anterior')}>‹</button>
        <p className="text-sm font-semibold text-gray-100">{t('pg_meses')[m - 1]} {anio}</p>
        <button type="button" onClick={() => mover(1)} className="rounded px-2 text-gray-400 hover:text-white" aria-label={t('vc_mes_siguiente')}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-gray-500">
        {t('vc_dias_semana').map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {semanas.flat().map((dia, i) => {
          if (!dia) return <div key={i} />;
          const habil = esHabil(dia);
          const fuera = vig.filter((v) => v.desde <= dia && v.hasta >= dia);
          return (
            <div key={dia} className={`min-h-[4.5rem] rounded-md border p-1 text-left ${dia === hoy ? 'border-sky-400' : 'border-gray-800'} ${habil ? 'bg-gray-950/40' : 'bg-gray-800/40'}`}
              title={FERIADOS.has(dia) ? t('vc_feriado') : ''}>
              <p className={`text-[10px] ${habil ? 'text-gray-400' : 'text-gray-600'}`}>{Number(dia.slice(8))}{FERIADOS.has(dia) ? ' ·' : ''}</p>
              <div className="mt-0.5 space-y-0.5">
                {fuera.map((v) => (
                  <p key={v.id} title={`${v.nombre} · ${ddmm(v.desde)}–${ddmm(v.hasta)}${v.estado === 'solicitada' ? ` · ${t('vc_estado_solicitada')}` : ''}`}
                    className={`truncate rounded px-1 text-[10px] leading-4 ${v.estado === 'solicitada' ? 'border border-dashed border-amber-400 text-amber-200' : `${colorDe(v.usuario_email)} text-white`}`}>
                    {primerNombre(v.nombre)}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-gray-500">{t('vc_leyenda')}</p>
    </section>
  );
}

function Proximas({ t, proximas, datos, colorDe, onAccion }) {
  const [ocupado, setOcupado] = useState(null);
  const cancelar = async (v) => {
    if (!window.confirm(t('vc_confirmar_cancelar'))) return;
    setOcupado(v.id);
    const e = await onAccion({ accion: 'cancelar', id: v.id });
    setOcupado(null);
    if (e) alert(e);
  };
  return (
    <Tarjeta titulo={t('vc_proximas')}>
      {proximas.length === 0 ? <p className="text-sm text-gray-500">{t('vc_sin_proximas')}</p> : (
        <ul className="divide-y divide-gray-800">
          {proximas.map((v) => {
            const propia = String(v.usuario_email).toLowerCase() === String(datos.yo.email).toLowerCase();
            const puedeCancelar = datos.puedeAprobar || (propia && v.desde > datos.hoy);
            return (
              <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${colorDe(v.usuario_email)}`} />
                <span className="text-gray-100">{v.nombre}</span>
                <span className="text-gray-400">{ddmm(v.desde)} – {ddmm(v.hasta)} · {t('vc_dias_habiles')(v.dias)}</span>
                <span className={`rounded-full border px-2 text-[11px] ${v.estado === 'aprobada' ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`}>{t(`vc_estado_${v.estado}`)}</span>
                {v.estado === 'solicitada' && <span className="text-[11px] text-gray-500">🔒 {t('vc_solo_gerencia')}</span>}
                {v.nota && <span className="text-xs text-gray-500">{v.nota}</span>}
                {puedeCancelar && (
                  <button type="button" disabled={ocupado === v.id} onClick={() => cancelar(v)} className="ml-auto text-xs text-gray-500 hover:text-red-400">{t('vc_cancelar')}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Tarjeta>
  );
}

function Totales({ t, lista, hoy, colorDe }) {
  const anio = Number(hoy.slice(0, 4));
  const por = new Map();
  for (const v of lista.filter(vigente)) {
    const k = String(v.usuario_email).toLowerCase();
    const x = por.get(k) || { nombre: v.nombre, email: v.usuario_email, aprobados: 0, solicitados: 0 };
    const d = diasHabilesEnAnio(v.desde, v.hasta, anio);
    if (v.estado === 'aprobada') x.aprobados += d; else x.solicitados += d;
    por.set(k, x);
  }
  const filas = [...por.values()].filter((x) => x.aprobados || x.solicitados).sort((a, b) => b.aprobados - a.aprobados);
  return (
    <Tarjeta titulo={t('vc_totales')(anio)}>
      {filas.length === 0 ? <p className="text-sm text-gray-500">{t('vc_sin_proximas')}</p> : (
        <ul className="space-y-1 text-sm">
          {filas.map((x) => (
            <li key={x.email} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${colorDe(x.email)}`} />
              <span className="flex-1 truncate text-gray-200">{x.nombre}</span>
              <span className="text-gray-100">{x.aprobados}</span>
              {x.solicitados > 0 && <span className="text-[11px] text-amber-300">+{x.solicitados} {t('vc_por_aprobar_corto')}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-gray-500">{t('vc_totales_ayuda')}</p>
    </Tarjeta>
  );
}
