'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';
import { hoyEnChile } from '@/lib/carga/payload';
import { normalizarPatente } from '@/lib/patente';
import { normalizarNombre } from '@/lib/fleet/nombres';
import PestanasHistorial from './PestanasHistorial';
import { fechaCorta } from './comun';

const RANGOS = [30, 90, 180, 365];
const DIA = 86400000;
const restar = (fecha, dias) => new Date(Date.parse(fecha) - dias * DIA).toISOString().slice(0, 10);
const MESES = { es: 'ene feb mar abr may jun jul ago sep oct nov dic', en: 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec', ru: 'янв фев мар апр май июн июл авг сен окт ноя дек' };
const primerNombre = (n) => String(n || '').split(' ')[0];

/**
 * Flota en el tiempo (R7). Cada fila es un auto con dos carriles: arriba
 * quién lo tenía según Fleet (y sus actas como puntos), abajo sus pasos por
 * taller con el nombre del taller. Meses marcados y la línea de hoy.
 */
export default function Tiempo() {
  const { t, lang } = useLang();
  const [dias, setDias] = useState(90);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(false);
  const [soloTaller, setSoloTaller] = useState(false);
  const [q, setQ] = useState('');
  const hasta = useMemo(() => hoyEnChile(), []);
  const desde = restar(hasta, dias);

  useEffect(() => {
    setDatos(null);
    fetch(`/api/historial/tiempo?desde=${desde}&hasta=${hasta}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDatos)
      .catch(() => setError(true));
  }, [desde, hasta]);

  const ini = Date.parse(desde);
  const total = Date.parse(hasta) + DIA - ini;
  const pos = (f) => Math.min(100, Math.max(0, ((Date.parse(String(f).slice(0, 10)) - ini) / total) * 100));
  const tramo = (d, h) => {
    const a = pos(d);
    const b = h ? pos(h) + (DIA / total) * 100 : 100;
    return { left: `${a}%`, width: `${Math.max(0.8, Math.min(100, b) - a)}%`, ancho: Math.min(100, b) - a };
  };

  const meses = useMemo(() => {
    const out = [];
    const d = new Date(`${desde}T12:00:00`);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const nombres = (MESES[lang] || MESES.es).split(' ');
    while (d.toISOString().slice(0, 10) <= hasta) {
      out.push({ fecha: d.toISOString().slice(0, 10), nombre: nombres[d.getMonth()] });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [desde, hasta, lang]);

  const filas = useMemo(() => {
    if (!datos) return [];
    const qp = normalizarPatente(q);
    const qn = normalizarNombre(q);
    return datos.autos.filter((a) => (!soloTaller || a.talleres.length > 0)
      && (!q.trim() || a.patente.includes(qp) || a.periodos.some((p) => normalizarNombre(p.conductor).includes(qn))));
  }, [datos, soloTaller, q]);

  const chip = (activo) => `rounded-full border px-2.5 py-1 text-[11px] ${activo ? 'border-gray-400 text-white' : 'border-gray-800 text-gray-400'}`;

  return (
    <div>
      <PestanasHistorial actual="tiempo" t={t} />
      <p className="mb-1 text-sm text-gray-300">{t('ti_intro')}</p>
      {datos?.datosConductorDesde && datos.datosConductorDesde > desde && (
        <p className="mb-3 text-xs text-gray-500">{t('ti_aviso_conductores')(fechaCorta(datos.datosConductorDesde))}</p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {RANGOS.map((r) => <button key={r} type="button" onClick={() => setDias(r)} className={chip(dias === r)}>{t('hv_ultimos_dias')(r)}</button>)}
        <button type="button" onClick={() => setSoloTaller((x) => !x)} className={chip(soloTaller)}>{t('ti_solo_taller')}</button>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hv_buscar')}
          className="ml-auto w-56 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-xs" />
      </div>

      <div className="mb-3 flex flex-wrap gap-4 text-[11px] text-gray-400">
        <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-sm bg-emerald-500/70" />{t('ti_ley_conductor')}</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-sm bg-violet-500/70" />{t('hv_ley_reemplazo')}</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-sm bg-amber-500/80" />{t('ti_ley_taller')}</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-white" />{t('ti_ley_acta')}</span>
      </div>

      {error && <p className="text-sm text-red-400">{t('hv_error')}</p>}
      {!datos && !error && <p className="text-sm text-gray-500">{t('hv_cargando')}</p>}
      {datos && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <div className="min-w-[760px]">
            <div className="flex border-b border-gray-800 text-[11px] text-gray-500">
              <div className="w-40 shrink-0 px-3 py-2">{t('ti_autos')(filas.length)}</div>
              <div className="relative mx-1 h-8 flex-1">
                <span className="absolute left-0 top-2">{fechaCorta(desde)}</span>
                {meses.map((m) => <span key={m.fecha} className="absolute top-2 -translate-x-1/2" style={{ left: `${pos(m.fecha)}%` }}>{m.nombre}</span>)}
                <span className="absolute right-0 top-2 text-emerald-300">{t('hv_hoy')}</span>
              </div>
            </div>
            {filas.length === 0 && <p className="px-3 py-6 text-center text-xs text-gray-500">{t('hv_sin_resultados')}</p>}
            {filas.map((a) => (
              <Link key={a.patente} href={`/historial?p=${a.patente}`} className="flex items-stretch border-b border-gray-800/60 hover:bg-gray-900/70">
                <div className="w-40 shrink-0 px-3 py-1.5">
                  <p className="font-mono text-xs font-semibold">{a.patente}</p>
                  <p className="truncate text-[10px] text-gray-500">{a.modelo}</p>
                </div>
                <div className="relative mx-1 h-11 flex-1">
                  {meses.map((m) => <span key={m.fecha} className="absolute inset-y-0 w-px bg-gray-800" style={{ left: `${pos(m.fecha)}%` }} />)}
                  <span className="absolute inset-y-0 right-0 w-px bg-emerald-500/60" />
                  {a.periodos.map((p, i) => {
                    const b = tramo(p.desde, p.hasta);
                    return (
                      <span key={`c${i}`} title={`${p.conductor || '—'} · ${fechaCorta(p.desde)} → ${p.hasta ? fechaCorta(p.hasta) : t('hv_hoy')}`}
                        className={`absolute top-1.5 h-3.5 overflow-hidden whitespace-nowrap rounded-sm px-1 text-[9px] leading-[14px] text-white ${p.reemplazo ? 'bg-violet-500/70' : 'bg-emerald-500/60'}`}
                        style={{ left: b.left, width: b.width }}>
                        {b.ancho > 7 ? primerNombre(p.conductor) : ''}
                      </span>
                    );
                  })}
                  {a.actas.map((e, i) => (
                    <span key={`a${i}`} title={`${t(`ev_${e.tipo}`)} · ${fechaCorta(e.fecha)}`}
                      className="absolute top-2 h-2.5 w-2.5 -ml-1 rounded-full border border-gray-900 bg-white" style={{ left: `${pos(e.fecha)}%` }} />
                  ))}
                  {a.talleres.map((p, i) => {
                    const b = tramo(p.desde, p.hasta);
                    return (
                      <span key={`t${i}`} title={`${p.taller} · ${t(`tl_motivo_${p.motivo}`)} · ${fechaCorta(p.desde)} → ${p.hasta ? fechaCorta(p.hasta) : t('tl_sigue_en_taller')}`}
                        className="absolute bottom-1.5 h-3.5 overflow-hidden whitespace-nowrap rounded-sm bg-amber-500/80 px-1 text-[9px] leading-[14px] text-gray-950"
                        style={{ left: b.left, width: b.width }}>
                        {b.ancho > 9 ? p.taller : ''}
                      </span>
                    );
                  })}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
