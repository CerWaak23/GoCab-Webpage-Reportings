'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';
import { supabaseNavegador } from '@/lib/supabase/browser';
import { normalizarPatente } from '@/lib/patente';
import { sha256Hex } from '@/lib/historial/imagen';
import { MOTIVOS, PAGADORES, ESTADOS_TALLER, sugerirTaller, sugerirPaga } from '@/lib/historial/taller';
import { fechaCorta, fechaHora } from './comun';

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const ahoraLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const campo = 'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm';
const etiqueta = 'block text-xs text-gray-400 mb-1';

async function enviar(cuerpo) {
  const r = await fetch('/api/historial/talleres', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  return { ok: r.ok, ...(await r.json().catch(() => ({}))) };
}

/** Talleres (R56-R60): lo usa el encargado de taller, en PC o en el celular. */
export default function Talleres() {
  const { t } = useLang();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(false);
  const [abierto, setAbierto] = useState(null); // { tipo: 'ingreso'|'actualizacion'|'salida', ... }

  const cargar = useCallback(() => {
    fetch('/api/historial/talleres').then((r) => (r.ok ? r.json() : Promise.reject())).then(setDatos).catch(() => setError(true));
  }, []);
  useEffect(() => {
    cargar();
    try {
      const p = normalizarPatente(new URLSearchParams(window.location.search).get('ingreso'));
      if (p) setAbierto({ tipo: 'ingreso', patente: p });
    } catch (_) { /* sin parámetro */ }
  }, [cargar]);

  if (error) return <p className="text-sm text-red-400">{t('hv_error')}</p>;
  if (!datos) return <p className="text-sm text-gray-500">{t('hv_cargando')}</p>;

  const listo = () => { setAbierto(null); cargar(); };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/m" className="text-xs text-gray-400 hover:text-white">← {t('rg_titulo')}</Link>
        <button type="button" onClick={() => setAbierto({ tipo: 'ingreso', patente: '' })} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-950">
          ＋ {t('tl_registrar_ingreso')}
        </button>
      </div>

      {abierto?.tipo === 'ingreso' && (
        <FormIngreso t={t} catalogo={datos.catalogo} inicial={abierto} onCancelar={() => setAbierto(null)} onListo={listo} />
      )}

      {datos.sinIngreso.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wider text-orange-300">{t('tl_sin_ingreso')} · {datos.sinIngreso.length}</h2>
          <p className="mb-2 text-xs text-gray-500">{t('tl_sin_ingreso_ayuda')}</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {datos.sinIngreso.map((a) => (
              <li key={a.patente} className="flex items-center justify-between gap-2 rounded-xl border border-orange-500/30 bg-orange-500/5 px-3 py-2">
                <div>
                  <Link href={`/historial?p=${a.patente}`} className="font-mono font-semibold hover:underline">{a.patente}</Link>
                  <p className="text-[11px] text-gray-500">{a.auto}{a.reemplazo ? ` · ${t('tl_conductor_en')(a.reemplazo.conductor, a.reemplazo.patente)}` : ''}</p>
                </div>
                <button type="button" onClick={() => setAbierto({ tipo: 'ingreso', patente: a.patente, auto: a.auto })} className="shrink-0 rounded-lg border border-orange-400/60 px-2.5 py-1 text-xs text-orange-200">
                  {t('tl_registrar')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {datos.reemplazosSinTaller.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wider text-violet-300">{t('tl_reemplazos_sin_taller')}</h2>
          <ul className="space-y-1 text-sm">
            {datos.reemplazosSinTaller.map((r) => (
              <li key={r.patente} className="text-gray-300">
                {t('tl_reemplazo_texto')(r.conductor, r.patente, r.reemplazaPatente)}
                <button type="button" onClick={() => setAbierto({ tipo: 'ingreso', patente: r.reemplazaPatente })} className="ml-2 text-xs text-violet-300 underline">{t('tl_registrar')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-amber-300">{t('tl_en_taller')} · {datos.abiertos.length}</h2>
        {datos.abiertos.length === 0 && <p className="text-sm text-gray-500">{t('tl_ninguno')}</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {datos.abiertos.map((p) => (
            <article key={p.id} id={p.patente} className={`rounded-xl border p-4 ${p.escalar?.nivel === 'gerencia' ? 'border-red-500/50' : p.escalar ? 'border-amber-500/50' : 'border-gray-800'} bg-gray-900/50`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/historial?p=${p.patente}`} className="font-mono text-lg font-bold hover:underline">{p.patente}</Link>
                  <p className="text-xs text-gray-400">{p.auto} · {p.taller}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{t('tl_dias')(p.dias)}</p>
                  {p.estado && <p className="text-[11px] text-sky-300">{t(`tl_estado_${p.estado}`)}</p>}
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-300">{t(`tl_motivo_${p.motivo}`)} · {t('tl_paga')}: {t(`tl_paga_${p.paga}`)}{p.ot ? ` · ${p.ot}` : ''}</p>
              <p className="mt-1 text-xs text-gray-500">{p.descripcion}</p>
              {p.reemplazo && <p className="mt-1 text-xs text-violet-300">{t('tl_conductor_en')(p.reemplazo.conductor, p.reemplazo.patente)}</p>}
              {p.escalar && (
                <p className={`mt-2 text-xs font-semibold ${p.escalar.nivel === 'gerencia' ? 'text-red-300' : 'text-amber-300'}`}>
                  ⚠ {t(`tl_escalar_${p.escalar.nivel}`)(p.escalar.dias)}
                </p>
              )}
              {p.actualizaciones.length > 0 && (
                <ol className="mt-3 space-y-1 border-l border-gray-800 pl-3">
                  {p.actualizaciones.slice(-3).map((a) => (
                    <li key={a.id} className="text-xs">
                      <span className="text-gray-500">{fechaHora(a.fecha)} · </span>
                      {a.estado && <span className="text-sky-300">{t(`tl_estado_${a.estado}`)}{a.monto != null ? ` ${CLP.format(a.monto)}` : ''} · </span>}
                      <span className="text-gray-300">{a.texto}</span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setAbierto({ tipo: 'actualizacion', paso: p })} className="flex-1 rounded-lg bg-gray-800 py-2 text-xs font-semibold">{t('tl_actualizar')}</button>
                <button type="button" onClick={() => setAbierto({ tipo: 'salida', paso: p })} className="flex-1 rounded-lg bg-emerald-700 py-2 text-xs font-semibold">{t('tl_dar_salida')}</button>
              </div>
              {abierto?.paso?.id === p.id && abierto.tipo === 'actualizacion' && <FormActualizacion t={t} paso={p} onCancelar={() => setAbierto(null)} onListo={listo} />}
              {abierto?.paso?.id === p.id && abierto.tipo === 'salida' && <FormSalida t={t} paso={p} onCancelar={() => setAbierto(null)} onListo={listo} />}
            </article>
          ))}
        </div>
      </section>

      {datos.historial.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wider text-gray-500">{t('tl_historial')}</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="text-gray-500">
                <tr className="border-b border-gray-800">
                  {['tl_col_patente', 'tl_col_taller', 'tl_col_motivo', 'tl_col_paga', 'tl_col_fechas', 'tl_col_dias', 'tl_col_monto'].map((k) => (
                    <th key={k} className="px-3 py-2 text-left font-normal">{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datos.historial.map((p) => (
                  <tr key={p.id} className="border-b border-gray-800/60">
                    <td className="px-3 py-2"><Link href={`/historial?p=${p.patente}`} className="font-mono hover:underline">{p.patente}</Link></td>
                    <td className="px-3 py-2">{p.taller}</td>
                    <td className="px-3 py-2">{t(`tl_motivo_${p.motivo}`)}</td>
                    <td className="px-3 py-2">{t(`tl_paga_${p.paga}`)}</td>
                    <td className="px-3 py-2 text-gray-400">{fechaCorta(p.ingreso)} → {fechaCorta(p.salida)}</td>
                    <td className="px-3 py-2">{p.dias}</td>
                    <td className="px-3 py-2">{p.monto != null ? CLP.format(p.monto) : '—'}{p.factura ? <span className="text-gray-500"> · {p.factura}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Errores({ lista, t }) {
  if (!lista?.length) return null;
  return <p className="text-xs text-red-400">{lista.map((e) => t(`tl_error_${e}`)).join(' · ')}</p>;
}

function FormIngreso({ t, catalogo, inicial, onCancelar, onListo }) {
  const [autos, setAutos] = useState(null);
  const [f, setF] = useState({ patente: inicial.patente || '', motivo: 'mantencion', paga: 'gocab', tallerId: '', ingreso: ahoraLocal(), km: '', ot: '', descripcion: '' });
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    fetch('/api/historial/vehiculos').then((r) => r.json()).then((d) => setAutos(d.filas || [])).catch(() => setAutos([]));
  }, []);

  const auto = autos?.find((a) => a.patente === normalizarPatente(f.patente)) || null;
  const sugerido = sugerirTaller(catalogo, auto || { marca: inicial.auto }, f.motivo);
  // Al cambiar el motivo o el auto, se proponen taller y pagador (se pueden cambiar).
  useEffect(() => {
    setF((x) => ({ ...x, tallerId: sugerido?.id || x.tallerId, paga: sugerirPaga(x.motivo) }));
  }, [f.motivo, auto?.patente]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    setGuardando(true);
    const r = await enviar({ accion: 'ingreso', ...f, patente: normalizarPatente(f.patente), ingreso: new Date(f.ingreso).toISOString() });
    setGuardando(false);
    if (r.ok) onListo();
    else setErrores(r.errores || [r.error]);
  }

  return (
    <section className="rounded-xl border border-amber-500/40 bg-gray-900/70 p-4 space-y-3">
      <h2 className="text-sm font-semibold">{t('tl_registrar_ingreso')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={etiqueta}>{t('tl_col_patente')}
          <input value={f.patente} onChange={(e) => setF({ ...f, patente: e.target.value.toUpperCase() })} list="patentes-taller" className={`${campo} font-mono`} />
          <datalist id="patentes-taller">{(autos || []).map((a) => <option key={a.patente} value={a.patente}>{[a.marca, a.modelo].join(' ')}</option>)}</datalist>
          {auto && <span className="mt-1 block text-[11px] text-gray-500">{[auto.marca, auto.modelo].join(' ')}{auto.conductor ? ` · ${auto.conductor}` : ''}</span>}
        </label>
        <label className={etiqueta}>{t('tl_col_motivo')}
          <select value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} className={campo}>
            {MOTIVOS.map((m) => <option key={m} value={m}>{t(`tl_motivo_${m}`)}</option>)}
          </select>
        </label>
        <label className={etiqueta}>{t('tl_col_taller')}
          <select value={f.tallerId} onChange={(e) => setF({ ...f, tallerId: e.target.value })} className={campo}>
            <option value="">—</option>
            {catalogo.filter((c) => c.activo).map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}{c.id === sugerido?.id ? ` (${t('tl_sugerido')})` : ''}</option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>{t('tl_col_paga')}
          <select value={f.paga} onChange={(e) => setF({ ...f, paga: e.target.value })} className={campo}>
            {PAGADORES.map((p) => <option key={p} value={p}>{t(`tl_paga_${p}`)}</option>)}
          </select>
        </label>
        <label className={etiqueta}>{t('tl_fecha_ingreso')}
          <input type="datetime-local" value={f.ingreso} onChange={(e) => setF({ ...f, ingreso: e.target.value })} className={campo} />
        </label>
        <label className={etiqueta}>{t('pr_km')}
          <input inputMode="numeric" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value.replace(/\D/g, '') })} className={campo} />
        </label>
        <label className={etiqueta}>{t('tl_ot')}
          <input value={f.ot} onChange={(e) => setF({ ...f, ot: e.target.value })} className={campo} />
        </label>
      </div>
      <label className={etiqueta}>{t('tl_descripcion')}
        <textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} className={campo} />
      </label>
      <Errores lista={errores} t={t} />
      <div className="flex gap-2">
        <button type="button" disabled={guardando} onClick={guardar} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-950 disabled:opacity-50">{t('hv_guardar')}</button>
        <button type="button" onClick={onCancelar} className="rounded-lg border border-gray-700 px-4 py-2 text-sm">{t('pr_volver')}</button>
      </div>
    </section>
  );
}

function FormActualizacion({ t, paso, onCancelar, onListo }) {
  const [f, setF] = useState({ texto: '', estado: '', monto: '' });
  const [errores, setErrores] = useState([]);
  async function guardar() {
    const r = await enviar({ accion: 'actualizacion', eventoId: paso.id, ...f, estado: f.estado || null });
    if (r.ok) onListo();
    else setErrores(r.errores || [r.error]);
  }
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-gray-700 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} className={campo}>
          <option value="">{t('tl_sin_cambio_estado')}</option>
          {ESTADOS_TALLER.map((e) => <option key={e} value={e}>{t(`tl_estado_${e}`)}</option>)}
        </select>
        {f.estado === 'presupuesto' && (
          <input inputMode="numeric" placeholder={t('tl_monto')} value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value.replace(/\D/g, '') })} className={campo} />
        )}
      </div>
      <textarea rows={2} placeholder={t('tl_que_paso')} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} className={campo} />
      <Errores lista={errores} t={t} />
      <div className="flex gap-2">
        <button type="button" onClick={guardar} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold">{t('hv_guardar')}</button>
        <button type="button" onClick={onCancelar} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs">{t('pr_volver')}</button>
      </div>
    </div>
  );
}

function FormSalida({ t, paso, onCancelar, onListo }) {
  const [f, setF] = useState({ salida: ahoraLocal(), factura: '', monto: '', nota: '' });
  const [archivo, setArchivo] = useState(null);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  async function subirFactura() {
    if (!archivo) return null;
    const ext = archivo.type === 'application/pdf' ? 'pdf' : archivo.type === 'image/png' ? 'png' : 'jpg';
    const uid = crypto.randomUUID();
    const r = await fetch('/api/historial/talleres/factura', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventoId: paso.id, uid, ext, tamano: archivo.size }),
    });
    if (!r.ok) throw new Error('url');
    const { ruta, token } = await r.json();
    const { error } = await supabaseNavegador().storage.from('documentos').uploadToSignedUrl(ruta, token, archivo, { contentType: archivo.type });
    if (error) throw error;
    return { ruta, sha256: await sha256Hex(archivo) };
  }

  async function guardar() {
    setGuardando(true);
    try {
      const subido = await subirFactura();
      const r = await enviar({ accion: 'salida', eventoId: paso.id, ...f, salida: new Date(f.salida).toISOString(), archivo: subido });
      if (r.ok) onListo();
      else setErrores(r.errores || [r.error]);
    } catch (_) {
      setErrores(['archivo']);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-700/60 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={etiqueta}>{t('tl_fecha_salida')}
          <input type="datetime-local" value={f.salida} onChange={(e) => setF({ ...f, salida: e.target.value })} className={campo} />
        </label>
        <label className={etiqueta}>{t('tl_factura')}
          <input value={f.factura} onChange={(e) => setF({ ...f, factura: e.target.value })} placeholder="N°" className={campo} />
        </label>
        <label className={etiqueta}>{t('tl_monto')}
          <input inputMode="numeric" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value.replace(/\D/g, '') })} className={campo} />
        </label>
        <label className={etiqueta}>{t('tl_archivo_factura')}
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] || null)} className="text-xs" />
        </label>
      </div>
      <p className="text-[11px] text-gray-500">{paso.paga === 'gocab' ? t('tl_suma_gastos') : t('tl_no_suma_gastos')(t(`tl_paga_${paso.paga}`))}</p>
      <textarea rows={2} placeholder={t('tl_nota_salida')} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} className={campo} />
      {paso.reemplazo && <p className="text-xs text-violet-300">{t('tl_recordar_reemplazo')(paso.reemplazo.conductor, paso.reemplazo.patente, paso.patente)}</p>}
      <Errores lista={errores} t={t} />
      <div className="flex gap-2">
        <button type="button" disabled={guardando} onClick={guardar} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{t('tl_dar_salida')}</button>
        <button type="button" onClick={onCancelar} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs">{t('pr_volver')}</button>
      </div>
    </div>
  );
}
