'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';
import { hoyEnChile } from '@/lib/carga/payload';
import { fechaCorta } from './comun';

const RANGOS = [30, 90, 180, 365];
const DIA = 86400000;
const restar = (fecha, dias) => new Date(Date.parse(fecha) - dias * DIA).toISOString().slice(0, 10);

/**
 * Flota por períodos (R7): una fila por auto, barras con el conductor que
 * Fleet le asignó y los pasos por taller, y puntos para los eventos.
 */
export default function Tiempo() {
  const { t } = useLang();
  const [dias, setDias] = useState(90);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(false);
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
  const barra = (d, h) => {
    const a = pos(d);
    const b = h ? pos(h) + (DIA / total) * 100 : 100;
    return { left: `${a}%`, width: `${Math.max(0.6, Math.min(100, b) - a)}%` };
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Link href="/historial" className="text-xs text-gray-400 hover:text-white">← {t('hv_volver_lista')}</Link>
        <div className="flex gap-1.5">
          {RANGOS.map((r) => (
            <button key={r} type="button" onClick={() => setDias(r)}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${dias === r ? 'border-gray-400 text-white' : 'border-gray-800 text-gray-400'}`}>
              {t('hv_ultimos_dias')(r)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-3 text-[11px] text-gray-400">
        <span className="flex items-center gap-1.5"><i className="w-3 h-2 rounded-sm bg-emerald-500/70" />{t('hv_ley_conductor')}</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-2 rounded-sm bg-violet-500/70" />{t('hv_ley_reemplazo')}</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-2 rounded-sm bg-amber-500/70" />{t('hv_ley_taller')}</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-white" />{t('hv_ley_evento')}</span>
      </div>

      {error && <p className="text-sm text-red-400">{t('hv_error')}</p>}
      {!datos && !error && <p className="text-sm text-gray-500">{t('hv_cargando')}</p>}
      {datos && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <div className="min-w-[720px]">
            <div className="flex text-[11px] text-gray-500 border-b border-gray-800">
              <div className="w-36 shrink-0 px-3 py-2" />
              <div className="flex-1 flex justify-between px-1 py-2">
                <span>{fechaCorta(desde)}</span><span>{fechaCorta(hasta)}</span>
              </div>
            </div>
            {datos.autos.map((a) => (
              <Link key={a.patente} href={`/historial?p=${a.patente}`} className="flex items-center border-b border-gray-800/60 hover:bg-gray-900/70">
                <div className="w-36 shrink-0 px-3 py-1.5">
                  <p className="font-mono text-xs font-semibold">{a.patente}</p>
                  <p className="text-[10px] text-gray-500 truncate">{a.modelo}</p>
                </div>
                <div className="relative flex-1 h-7 mx-1">
                  {a.periodos.map((p, i) => (
                    <span key={i} title={`${p.conductor || ''} · ${fechaCorta(p.desde)} → ${p.hasta ? fechaCorta(p.hasta) : t('hv_hoy')}`}
                      className={`absolute top-1.5 h-4 rounded-sm ${p.reemplazo ? 'bg-violet-500/70' : 'bg-emerald-500/60'}`} style={barra(p.desde, p.hasta)} />
                  ))}
                  {a.eventos.filter((e) => e.tipo === 'taller').map((e, i) => (
                    <span key={`t${i}`} className="absolute top-1.5 h-4 rounded-sm bg-amber-500/70" style={barra(e.fecha, e.salida)} />
                  ))}
                  {a.eventos.map((e, i) => (
                    <span key={`e${i}`} title={`${t(`ev_${e.tipo}`)} · ${fechaCorta(e.fecha)}`}
                      className="absolute top-2.5 w-2 h-2 -ml-1 rounded-full bg-white" style={{ left: `${pos(e.fecha)}%` }} />
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
