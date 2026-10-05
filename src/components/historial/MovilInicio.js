'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';
import { normalizarPatente } from '@/lib/patente';
import { normalizarNombre } from '@/lib/fleet/nombres';
import { listarBorradores, borrarBorrador } from '@/lib/historial/borrador';
import { ChipEstado } from './comun';

/**
 * Inicio del celular del coordinador: borradores en curso (R71), autos con
 * entrega pendiente y buscador para abrir una entrega o recepción.
 */
export default function MovilInicio() {
  const { t } = useLang();
  const [lista, setLista] = useState(null);
  const [borradores, setBorradores] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/historial/vehiculos').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => setLista(d.filas)).catch(() => setLista([]));
    listarBorradores('acta:').then(setBorradores);
  }, []);

  const filtrados = useMemo(() => {
    if (!lista) return [];
    const qp = normalizarPatente(q);
    const qn = normalizarNombre(q);
    if (!q.trim()) return lista.filter((f) => f.estado === 'entrega_pendiente');
    return lista.filter((f) => f.patente.includes(qp) || normalizarNombre(f.conductor).includes(qn)).slice(0, 30);
  }, [lista, q]);

  const boton = 'flex-1 rounded-lg py-2 text-center text-sm font-bold';

  return (
    <div className="space-y-6 text-gray-900">
      {borradores.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{t('m_borradores')}</h2>
          <ul className="space-y-2">
            {borradores.map(({ clave, valor }) => {
              const hechas = Object.keys(valor.fotos || {}).length;
              return (
                <li key={clave} className="flex items-center gap-3 rounded-xl border-2 border-amber-300 bg-white p-3">
                  <Link href={`/m/protocolo?tipo=${valor.tipo}&patente=${valor.patente}`} className="flex-1">
                    <p className="font-mono font-bold">{valor.patente}</p>
                    <p className="text-sm text-gray-600">{t(`ev_${valor.tipo}`)} · {t('m_avance')(hechas)}</p>
                  </Link>
                  <button type="button" onClick={async () => { if (window.confirm(t('pr_descartar_confirmar'))) { await borrarBorrador(clave); setBorradores((x) => x.filter((y) => y.clave !== clave)); } }}
                    className="text-sm text-red-600 underline">{t('m_descartar')}</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hv_buscar')}
          className="w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-lg" />
        <h2 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-gray-500">
          {q.trim() ? t('m_resultados') : t('m_entregas_pendientes')}
        </h2>
        {!lista && <p className="text-gray-500">{t('hv_cargando')}</p>}
        {lista && filtrados.length === 0 && <p className="text-sm text-gray-500">{q.trim() ? t('hv_sin_resultados') : t('m_sin_pendientes')}</p>}
        <ul className="space-y-2">
          {filtrados.map((f) => (
            <li key={f.patente} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-lg font-bold">{f.patente}</span>
                <ChipEstado estado={f.estado} t={t} />
              </div>
              <p className="mb-2 text-sm text-gray-600">{f.conductor || [f.marca, f.modelo].filter(Boolean).join(' ')}</p>
              <div className="flex gap-2">
                <Link href={`/m/protocolo?tipo=entrega&patente=${f.patente}`} className={`${boton} bg-emerald-600 text-white`}>{t('ev_entrega')}</Link>
                <Link href={`/m/protocolo?tipo=recepcion&patente=${f.patente}`} className={`${boton} bg-gray-900 text-white`}>{t('ev_recepcion')}</Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
