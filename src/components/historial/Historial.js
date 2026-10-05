'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';
import { normalizarNombre } from '@/lib/fleet/nombres';
import { normalizarPatente } from '@/lib/patente';
import { ESTADOS } from '@/lib/historial/estado';
import { ChipEstado, textoAlerta } from './comun';
import Ficha from './Ficha';

const leerPatenteUrl = () => {
  try { return normalizarPatente(new URLSearchParams(window.location.search).get('p')) || null; } catch (_) { return null; }
};

/**
 * Historial de vehículos: lista con buscador y filtros por estado, y la
 * ficha al lado en PC o en pantalla completa en el celular (R1-R3).
 * La patente abierta va en la URL (?p=) para poder enlazarla desde otras secciones.
 */
export default function Historial() {
  const { t } = useLang();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState(null);
  const [abierta, setAbierta] = useState(null);

  useEffect(() => {
    setAbierta(leerPatenteUrl());
    const onPop = () => setAbierta(leerPatenteUrl());
    window.addEventListener('popstate', onPop);
    fetch('/api/historial/vehiculos').then((r) => (r.ok ? r.json() : Promise.reject())).then(setDatos).catch(() => setError(true));
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function abrir(patente) {
    setAbierta(patente);
    const url = patente ? `/historial?p=${patente}` : '/historial';
    window.history.pushState(null, '', url);
  }

  const filas = useMemo(() => {
    if (!datos) return [];
    const q = busqueda.trim();
    const qPat = normalizarPatente(q);
    const qNom = normalizarNombre(q);
    return datos.filas.filter((f) => (!filtro || f.estado === filtro)
      && (!q || f.patente.includes(qPat) || normalizarNombre(f.conductor).includes(qNom)));
  }, [datos, busqueda, filtro]);

  if (error) return <p className="text-sm text-red-400">{t('hv_error')}</p>;
  if (!datos) return <p className="text-sm text-gray-500">{t('hv_cargando')}</p>;
  if (datos.filas.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 p-6 text-sm text-gray-400">
        {t('hv_vacio')} <Link href="/carga" className="text-sky-400 hover:underline">{t('carga_title')}</Link>
      </div>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(320px,400px)_1fr] lg:gap-5">
      <section className={abierta ? 'hidden lg:block' : ''}>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t('hv_buscar')}
            className="flex-1 min-w-0 rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:border-gray-600"
          />
          <Link href="/m" className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
            {t('rg_titulo')}
          </Link>
          <Link href="/historial/talleres" className="shrink-0 rounded-lg border border-amber-500/40 px-3 py-2 text-xs text-amber-200 hover:border-amber-400">
            {t('talleres_title')}
          </Link>
          <Link href="/historial/tiempo" className="hidden lg:inline-flex shrink-0 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:border-gray-600">
            {t('hv_tiempo')}
          </Link>
          <Link href="/historial/configuracion" title={t('cf_titulo')} className="hidden lg:inline-flex shrink-0 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:border-gray-600">
            ⚙
          </Link>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <button type="button" onClick={() => setFiltro(null)}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] ${!filtro ? 'border-gray-400 text-white' : 'border-gray-800 text-gray-400'}`}>
            {t('hv_todos')} · {datos.filas.length}
          </button>
          {ESTADOS.filter((e) => datos.conteo[e] > 0).map((e) => (
            <button key={e} type="button" onClick={() => setFiltro(filtro === e ? null : e)}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] ${filtro === e ? 'border-gray-400 text-white' : 'border-gray-800 text-gray-400'}`}>
              {t(`estado_${e}`)} · {datos.conteo[e]}
            </button>
          ))}
        </div>

        <ul className="divide-y divide-gray-800/70 rounded-xl border border-gray-800 overflow-hidden lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
          {filas.map((f) => (
            <li key={f.patente}>
              <button type="button" onClick={() => abrir(f.patente)}
                className={`w-full text-left px-3 py-2.5 hover:bg-gray-900 transition ${abierta === f.patente ? 'bg-gray-900' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold tracking-wide">{f.patente}</span>
                  <ChipEstado estado={f.estado} t={t} />
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-gray-500">
                  <span className="truncate">{f.conductor || [f.marca, f.modelo].filter(Boolean).join(' ') || '—'}</span>
                  {f.alertas.length > 0 && (
                    <span className="shrink-0 text-amber-400" title={f.alertas.map((a) => textoAlerta(a, t)).join(' · ')}>
                      ⚠ {f.alertas.length}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
          {filas.length === 0 && <li className="px-3 py-6 text-center text-xs text-gray-500">{t('hv_sin_resultados')}</li>}
        </ul>
      </section>

      <section className={abierta ? '' : 'hidden lg:block'}>
        {abierta
          ? <Ficha key={abierta} patente={abierta} onVolver={() => abrir(null)} t={t} />
          : <div className="h-full min-h-[300px] rounded-xl border border-dashed border-gray-800 flex items-center justify-center text-sm text-gray-600">{t('hv_elige')}</div>}
      </section>
    </div>
  );
}
