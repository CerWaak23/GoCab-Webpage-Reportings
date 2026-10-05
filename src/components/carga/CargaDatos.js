'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang } from '@/lib/i18n/useLang';
import { supabaseNavegador } from '@/lib/supabase/browser';
import { ORDEN_TIPOS } from '@/lib/carga/payload';
import { validarArchivo } from '@/lib/carga/permisos';

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

async function pedir(url, cuerpo) {
  const r = await fetch(url, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : undefined);
  return r.json().catch(() => ({ error: 'red' }));
}

function haceCuanto(iso, t) {
  if (!iso) return t('carga_nunca');
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return t('carga_hace_min')(min);
  if (min < 48 * 60) return t('carga_hace_h')(Math.round(min / 60));
  return t('carga_hace_d')(Math.round(min / 1440));
}

/** Pantalla de Carga de datos: sube exports de Fleet, muestra qué cambiaría y los aplica. */
export default function CargaDatos() {
  const { t } = useLang();
  const [estado, setEstado] = useState(null);
  const [archivos, setArchivos] = useState([]);
  const [aplicando, setAplicando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const input = useRef(null);

  const cargarEstado = useCallback(() => pedir('/api/carga/estado').then(setEstado), []);
  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  const actualizar = (clave, cambios) => setArchivos((xs) => xs.map((x) => (x.clave === clave ? { ...x, ...cambios } : x)));

  async function procesar(file) {
    const clave = `${file.name}-${file.size}-${Date.now()}`;
    setArchivos((xs) => [...xs, { clave, nombre: file.name, paso: 'subiendo' }]);
    const v = validarArchivo(file.name, file.size);
    if (v.error) return actualizar(clave, { paso: 'error', error: `carga_error_${v.error}` });

    const subida = await pedir('/api/carga/subir', { nombre: file.name, tamano: file.size });
    if (subida.error) return actualizar(clave, { paso: 'error', error: 'carga_error' });
    const { error } = await supabaseNavegador().storage.from('cargas').uploadToSignedUrl(subida.ruta, subida.token, file);
    if (error) return actualizar(clave, { paso: 'error', error: 'carga_error' });

    actualizar(clave, { paso: 'leyendo' });
    const r = await pedir('/api/carga/revisar', { ruta: subida.ruta, nombre: file.name });
    if (r.error) return actualizar(clave, { paso: 'error', error: r.error === 'vacio' || r.error === 'no_reconocido' ? `carga_${r.error}` : 'carga_error' });
    actualizar(clave, { paso: 'revisado', ...r });
  }

  function elegir(lista) {
    for (const f of Array.from(lista || [])) procesar(f);
  }

  async function aplicar() {
    const ids = archivos.filter((a) => a.paso === 'revisado').map((a) => a.id);
    if (ids.length === 0) return;
    const confirmados = archivos.filter((a) => a.paso === 'revisado' && a.confirmado).map((a) => a.id);
    setAplicando(true);
    const r = await pedir('/api/carga/aplicar', { ids, confirmados });
    for (const res of r.resultados || []) {
      setArchivos((xs) => xs.map((x) => {
        if (x.id !== res.id) return x;
        if (res.ok) return { ...x, paso: 'aplicado', drive: res.drive, resultado: res.resultado };
        // Avisos nuevos (p. ej. otra persona aplicó un archivo más reciente): se piden de nuevo.
        if (res.motivo === 'confirmar') return { ...x, avisos: res.avisos, confirmado: false };
        return { ...x, paso: 'fallo', motivo: res.motivo };
      }));
    }
    setAplicando(false);
    cargarEstado();
  }

  const porAplicar = archivos.filter((a) => a.paso === 'revisado').length;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">{t('carga_ultimas')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ORDEN_TIPOS.map((tipo) => {
            const u = estado?.ultimas?.[tipo];
            return (
              <div key={tipo} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
                <p className="text-sm font-medium">{t(`tipo_${tipo}`)}</p>
                <p className={`text-xs mt-1 ${u ? 'text-gray-400' : 'text-amber-400'}`}>{estado ? haceCuanto(u?.en, t) : '…'}</p>
                {u && <p className="text-[11px] text-gray-600 mt-1 truncate" title={u.archivo}>{u.filas} {t('carga_filas')}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files); }}
          className={`w-full rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${arrastrando ? 'border-sky-400 bg-sky-500/10' : 'border-gray-700 hover:border-gray-500'}`}
        >
          <p className="text-sm">{t('carga_soltar')}</p>
          <p className="text-xs text-gray-500 mt-1">{t('carga_formatos')}</p>
        </button>
        <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { elegir(e.target.files); e.target.value = ''; }} />
      </section>

      {archivos.length > 0 && (
        <section className="space-y-3">
          {archivos.map((a) => (
            <TarjetaArchivo key={a.clave} a={a} t={t} onConfirmar={(v) => actualizar(a.clave, { confirmado: v })} />
          ))}
          {porAplicar > 0 && (
            estado?.puedeAplicar
              ? <button type="button" disabled={aplicando} onClick={aplicar}
                  className="w-full sm:w-auto rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-gray-950 font-semibold text-sm px-5 py-2.5">
                  {aplicando ? t('carga_aplicando') : `${t('carga_aplicar')} (${porAplicar})`}
                </button>
              : <p className="text-xs text-gray-500">{t('carga_solo_gerencia')}</p>
          )}
        </section>
      )}

      {estado?.diferencias?.length > 0 && archivos.length === 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">{t('carga_diferencias')}</h2>
          <Diferencias lista={estado.diferencias} t={t} />
        </section>
      )}

      {estado?.historial?.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">{t('carga_historial')}</h2>
          <ul className="divide-y divide-gray-800 rounded-xl border border-gray-800 text-xs">
            {estado.historial.map((c) => (
              <li key={c.id} className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5 justify-between">
                <span className="text-gray-300">{t(`tipo_${c.tipo}`)} · <span className="text-gray-500">{c.archivo}</span></span>
                <span className="text-gray-500">{new Date(c.creado).toLocaleString()} · {t('carga_por')} {c.usuario_email}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TarjetaArchivo({ a, t, onConfirmar }) {
  const etiqueta = {
    subiendo: <span className="text-gray-400">{t('carga_subiendo')}</span>,
    leyendo: <span className="text-gray-400">{t('carga_leyendo')}</span>,
    error: <span className="text-red-400">{t(a.error)}</span>,
    revisado: <span className="text-sky-300">{t(`tipo_${a.tipo}`)} · {a.filas} {t('carga_filas')}</span>,
    aplicado: <span className="text-emerald-400">✓ {t('carga_aplicada')}</span>,
    fallo: <span className="text-red-400">{t(a.motivo === 'ya_aplicada' ? 'carga_ya_aplicada' : 'carga_fallo')}</span>,
  }[a.paso];

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium truncate max-w-full">{a.nombre}</p>
        <p className="text-xs">{etiqueta}</p>
      </div>
      {a.avisos?.length > 0 && a.paso === 'revisado' && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1">
          {a.avisos.map((k) => <p key={k} className="text-amber-300">⚠ {t(`aviso_${k}`)}</p>)}
          <label className="flex items-center gap-2 pt-1 text-gray-200">
            <input type="checkbox" checked={!!a.confirmado} onChange={(e) => onConfirmar(e.target.checked)} />
            {t('carga_aplicar_igual')}
          </label>
        </div>
      )}
      {a.resumen && <Resumen r={a.resumen} t={t} />}
      {a.resumen?.calidad && <Calidad c={a.resumen.calidad} t={t} />}
      {a.resultado && <Resultado r={a.resultado} t={t} />}
      {a.drive && <p className="text-[11px] text-gray-500 mt-2">{t(a.drive.copiado ? 'carga_drive_ok' : 'carga_drive_sin_carpeta')}</p>}
      {a.tipo === 'vehicles' && a.paso !== 'aplicado' && (
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-2">{t('carga_diferencias')}</p>
          <Diferencias lista={a.diferencias || []} t={t} />
        </div>
      )}
    </div>
  );
}

function Resumen({ r, t }) {
  const valor = (k, v) => (k === 'saldo' ? CLP.format(v) : typeof v === 'number' ? v.toLocaleString('es-CL') : null);
  const items = Object.entries(r)
    .map(([k, v]) => [k, Array.isArray(v) ? v.length.toLocaleString('es-CL') : valor(k, v)])
    .filter(([, v]) => v !== null);
  return (
    <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-gray-950/60 px-2.5 py-1.5">
          <dt className="text-[11px] text-gray-500">{t(`r_${k}`)}</dt>
          <dd className="text-sm font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Calidad({ c, t }) {
  const problemas = Object.entries(c.problemas || {});
  const cruce = c.cruce ? Object.entries(c.cruce).filter(([, n]) => n > 0) : [];
  if (problemas.length === 0 && cruce.length === 0) return null;
  return (
    <div className="mt-3 grid sm:grid-cols-2 gap-3 text-xs">
      {problemas.length > 0 && (
        <div>
          <p className="text-gray-500 mb-1">{t('carga_problemas')}</p>
          <ul className="space-y-0.5">
            {problemas.map(([k, n]) => <li key={k} className="text-amber-300">{t(`calidad_${k}`)}: <b>{n}</b></li>)}
          </ul>
        </div>
      )}
      {cruce.length > 0 && (
        <div>
          <p className="text-gray-500 mb-1">{t('carga_cruce')}</p>
          <ul className="space-y-0.5">
            {cruce.map(([k, n]) => <li key={k} className={k === 'sin' || k === 'ambiguo' ? 'text-amber-300' : 'text-gray-300'}>{t(`cruce_${k}`)}: <b>{n.toLocaleString('es-CL')}</b></li>)}
          </ul>
          {c.noEncontrados?.length > 0 && (
            <details className="mt-1 text-gray-400">
              <summary className="cursor-pointer">{t('carga_ver_no_encontrados')} ({c.totalNoEncontrados})</summary>
              <p className="mt-1 leading-relaxed">{c.noEncontrados.join(' · ')}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Resultado({ r, t }) {
  const items = Object.entries(r).filter(([, v]) => typeof v === 'number' && v > 0);
  if (items.length === 0) return null;
  return (
    <p className="mt-3 text-xs text-emerald-300">
      {items.map(([k, v]) => `${t(`res_${k}`)}: ${v}`).join(' · ')}
    </p>
  );
}

function Diferencias({ lista, t }) {
  if (lista.length === 0) return <p className="text-xs text-gray-500">{t('carga_sin_diferencias')}</p>;
  const nombre = { nuevo: 'carga_nuevo', cambio_conductor: 'carga_cambio', ausente: 'carga_ausente' };
  return (
    <ul className="max-h-72 overflow-y-auto divide-y divide-gray-800 rounded-lg border border-gray-800 text-xs">
      {lista.map((d) => (
        <li key={`${d.tipo}-${d.patente}`} className="px-3 py-1.5 flex flex-wrap gap-x-3 justify-between">
          <span><span className="font-mono text-gray-200">{d.patente}</span> · <span className="text-gray-400">{t(nombre[d.tipo])}</span>
            {d.tipo === 'cambio_conductor' && <span className="text-gray-500"> · {d.antes || '—'} → {d.ahora || '—'}</span>}
          </span>
          {d.faltaActa && <span className="text-amber-400">{t(`carga_falta_${d.faltaActa}`)}</span>}
          {d.sinFotosIngreso && <span className="text-amber-400">{t('carga_faltan_fotos')}</span>}
        </li>
      ))}
    </ul>
  );
}
