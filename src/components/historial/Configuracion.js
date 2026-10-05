'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';

/**
 * Configuración del Historial: checklist de entrega y recepción (cada cambio
 * crea una versión nueva, R10), plazo de la revisión periódica (R36),
 * teléfono de asistencia SURA (R81) y RUT de la empresa (R77).
 */
export default function Configuracion() {
  const { t } = useLang();
  const [datos, setDatos] = useState(null);
  const [grupos, setGrupos] = useState([]);
  const [ajustes, setAjustes] = useState({});
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    fetch('/api/historial/configuracion').then((r) => r.json()).then((d) => {
      setDatos(d);
      setGrupos(d.checklist?.items || []);
      setAjustes(d.ajustes || {});
    });
  }, []);

  if (!datos) return <p className="text-sm text-gray-500">{t('hv_cargando')}</p>;
  const editable = datos.puedeEditar;

  async function guardar(cuerpo) {
    setMensaje(null);
    const r = await fetch('/api/historial/configuracion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMensaje({ error: true, texto: t(`cf_error_${j.motivo || j.clave || j.error}`) });
      return;
    }
    if (j.checklist) {
      setDatos((d) => ({ ...d, checklist: j.checklist }));
      setGrupos(j.checklist.items);
      setMensaje({ texto: t('cf_checklist_guardada')(j.checklist.version) });
    } else setMensaje({ texto: t('cf_guardado') });
  }

  const cambiarGrupo = (gi, cambio) => setGrupos((gs) => gs.map((g, i) => (i === gi ? { ...g, ...cambio } : g)));
  const cambiarItem = (gi, ii, valor) => cambiarGrupo(gi, { items: grupos[gi].items.map((x, j) => (j === ii ? valor : x)) });
  const mover = (gi, ii, d) => {
    const items = [...grupos[gi].items];
    const j = ii + d;
    if (j < 0 || j >= items.length) return;
    [items[ii], items[j]] = [items[j], items[ii]];
    cambiarGrupo(gi, { items });
  };
  const campo = 'rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm disabled:opacity-60';

  return (
    <div className="space-y-8">
      <Link href="/m" className="text-xs text-gray-400 hover:text-white">← {t('rg_titulo')}</Link>
      {!editable && <p className="text-sm text-amber-300">{t('cf_solo_gerencia')}</p>}
      {mensaje && <p className={`text-sm ${mensaje.error ? 'text-red-400' : 'text-emerald-400'}`}>{mensaje.texto}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t('cf_ajustes')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-gray-400">{t('cf_revision_dias')}
            <input type="number" min={7} max={180} disabled={!editable} value={ajustes.revision_dias ?? ''}
              onChange={(e) => setAjustes({ ...ajustes, revision_dias: e.target.value })} className={`${campo} mt-1 w-full`} />
          </label>
          <label className="block text-xs text-gray-400">{t('cf_telefono_sura')}
            <input disabled={!editable} value={ajustes.telefono_asistencia_sura ?? ''}
              onChange={(e) => setAjustes({ ...ajustes, telefono_asistencia_sura: e.target.value })} className={`${campo} mt-1 w-full`} />
          </label>
          <label className="block text-xs text-gray-400">{t('cf_rut_empresa')}
            <input disabled={!editable} value={ajustes.rut_empresa ?? ''}
              onChange={(e) => setAjustes({ ...ajustes, rut_empresa: e.target.value })} className={`${campo} mt-1 w-full`} />
          </label>
        </div>
        {editable && (
          <button type="button" onClick={() => guardar({ ajustes })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold">{t('hv_guardar')}</button>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t('cf_checklist')(datos.checklist?.version)}</h2>
        <p className="text-xs text-gray-500">{t('cf_checklist_ayuda')}</p>
        {grupos.map((g, gi) => (
          <div key={gi} className="rounded-xl border border-gray-800 p-3 space-y-2">
            <div className="flex gap-2">
              <input disabled={!editable} value={g.grupo} onChange={(e) => cambiarGrupo(gi, { grupo: e.target.value })} className={`${campo} flex-1 font-semibold`} />
              {editable && <button type="button" onClick={() => setGrupos(grupos.filter((_, i) => i !== gi))} className="text-xs text-red-400">{t('cf_quitar_grupo')}</button>}
            </div>
            {g.items.map((item, ii) => (
              <div key={ii} className="flex items-center gap-2 pl-3">
                <input disabled={!editable} value={item} onChange={(e) => cambiarItem(gi, ii, e.target.value)} className={`${campo} flex-1`} />
                {editable && (
                  <span className="flex gap-1 text-xs text-gray-400">
                    <button type="button" onClick={() => mover(gi, ii, -1)} aria-label="Subir">↑</button>
                    <button type="button" onClick={() => mover(gi, ii, 1)} aria-label="Bajar">↓</button>
                    <button type="button" onClick={() => cambiarGrupo(gi, { items: g.items.filter((_, j) => j !== ii) })} className="text-red-400">✕</button>
                  </span>
                )}
              </div>
            ))}
            {editable && <button type="button" onClick={() => cambiarGrupo(gi, { items: [...g.items, ''] })} className="pl-3 text-xs text-sky-400">＋ {t('cf_agregar_item')}</button>}
          </div>
        ))}
        {editable && (
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setGrupos([...grupos, { grupo: '', items: [''] }])} className="rounded-lg border border-gray-700 px-4 py-2 text-sm">＋ {t('cf_agregar_grupo')}</button>
            <button type="button" onClick={() => guardar({ checklist: grupos })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold">{t('cf_guardar_version')}</button>
          </div>
        )}
      </section>
    </div>
  );
}
