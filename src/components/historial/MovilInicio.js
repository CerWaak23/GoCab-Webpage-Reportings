'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';
import { normalizarPatente } from '@/lib/patente';
import { normalizarNombre } from '@/lib/fleet/nombres';
import { listarBorradores, borrarBorrador } from '@/lib/historial/borrador';
import { ChipEstado } from './comun';

/**
 * Registros: el lugar del coordinador (y del encargado de taller) para
 * registrar lo que pasa con un auto, pensado para el celular. Primero se
 * elige qué registrar y después el auto; cada acción propone los autos que
 * más probablemente correspondan.
 */
const ACCIONES = [
  {
    id: 'entrega', color: 'bg-emerald-600', actas: true,
    sugeridos: (f) => ['entrega_pendiente', 'disponible', 'fotos_ingreso'].includes(f.estado),
    destino: (p) => `/m/protocolo?tipo=entrega&patente=${p}`,
  },
  {
    id: 'recepcion', color: 'bg-gray-900', actas: true,
    sugeridos: (f) => !!f.conductor,
    destino: (p) => `/m/protocolo?tipo=recepcion&patente=${p}`,
  },
  // Talleres ya reúne ingreso, avances y salida: se abre directo, sin elegir auto aquí.
  { id: 'taller', color: 'bg-amber-600', href: '/historial/talleres' },
  { id: 'siniestro', pronto: true },
  { id: 'auto_nuevo', pronto: true },
];

export default function MovilInicio({ puedeActas = true, puedeConfigurar = false }) {
  const { t } = useLang();
  const [lista, setLista] = useState(null);
  const [borradores, setBorradores] = useState([]);
  const [accion, setAccion] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/historial/vehiculos').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => setLista(d.filas)).catch(() => setLista([]));
    listarBorradores('acta:').then(setBorradores);
  }, []);

  const elegida = ACCIONES.find((a) => a.id === accion) || null;
  const autos = useMemo(() => {
    if (!lista || !elegida) return [];
    if (q.trim()) {
      const qp = normalizarPatente(q);
      const qn = normalizarNombre(q);
      return lista.filter((f) => f.patente.includes(qp) || normalizarNombre(f.conductor).includes(qn)).slice(0, 30);
    }
    return lista.filter(elegida.sugeridos).slice(0, 50);
  }, [lista, elegida, q]);

  const visibles = ACCIONES.filter((a) => puedeActas || !a.actas);

  if (elegida) {
    return (
      <div className="space-y-4 text-gray-900">
        <button type="button" onClick={() => { setAccion(null); setQ(''); }} className="text-sm font-semibold text-gray-600">← {t('rg_titulo')}</button>
        <h1 className="text-2xl font-extrabold">{t(`rg_${elegida.id}`)}</h1>
        <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hv_buscar')}
          className="w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-lg" />
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">{q.trim() ? t('m_resultados') : t(`rg_sugeridos_${elegida.id}`)}</h2>
        {!lista && <p className="text-gray-500">{t('hv_cargando')}</p>}
        {lista && autos.length === 0 && <p className="text-sm text-gray-500">{q.trim() ? t('hv_sin_resultados') : t('rg_sin_sugeridos')}</p>}
        <ul className="space-y-2">
          {autos.map((f) => (
            <li key={f.patente}>
              <Link href={elegida.destino(f.patente)} className="block rounded-xl bg-white p-3 shadow-sm active:scale-[0.99]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-lg font-bold">{f.patente}</span>
                  <ChipEstado estado={f.estado} t={t} />
                </div>
                <p className="text-sm text-gray-600">{f.conductor || [f.marca, f.modelo].filter(Boolean).join(' ')}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-gray-900">
      <h1 className="text-2xl font-extrabold">{t('rg_titulo')}</h1>

      {borradores.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{t('m_borradores')}</h2>
          <ul className="space-y-2">
            {borradores.map(({ clave, valor }) => (
              <li key={clave} className="flex items-center gap-3 rounded-xl border-2 border-amber-300 bg-white p-3">
                <Link href={`/m/protocolo?tipo=${valor.tipo}&patente=${valor.patente}`} className="flex-1">
                  <p className="font-mono font-bold">{valor.patente}</p>
                  <p className="text-sm text-gray-600">{t(`ev_${valor.tipo}`)} · {t('m_avance')(Object.keys(valor.fotos || {}).length)}</p>
                </Link>
                <button type="button" onClick={async () => { if (window.confirm(t('pr_descartar_confirmar'))) { await borrarBorrador(clave); setBorradores((x) => x.filter((y) => y.clave !== clave)); } }}
                  className="text-sm text-red-600 underline">{t('m_descartar')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3">
        {visibles.map((a) => {
          const clase = `min-h-[96px] rounded-2xl p-4 text-left text-white shadow-sm transition active:scale-[0.98] disabled:bg-gray-300 disabled:text-gray-500 ${a.color || ''}`;
          const contenido = (
            <>
              <p className="text-lg font-extrabold leading-tight">{t(`rg_${a.id}`)}</p>
              <p className="mt-1 text-xs opacity-80">{a.pronto ? t('rg_pronto') : t(`rg_${a.id}_ayuda`)}</p>
            </>
          );
          return a.href
            ? <Link key={a.id} href={a.href} className={`block ${clase}`}>{contenido}</Link>
            : <button key={a.id} type="button" disabled={a.pronto} onClick={() => setAccion(a.id)} className={clase}>{contenido}</button>;
        })}
      </section>

      {puedeConfigurar && (
        <Link href="/historial/configuracion" className="block text-center text-sm font-semibold text-gray-500 underline">
          {t('rg_configuracion')}
        </Link>
      )}

      {lista && (
        <section className="rounded-xl bg-white p-4 text-sm text-gray-600 shadow-sm">
          <p>{t('rg_resumen')(
            lista.filter((f) => f.estado === 'entrega_pendiente').length,
            lista.filter((f) => f.estado === 'sin_ingreso_taller').length,
            lista.filter((f) => f.estado === 'en_taller').length,
          )}</p>
        </section>
      )}
    </div>
  );
}
