'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';
import { supabaseNavegador } from '@/lib/supabase/browser';
import { leerBorrador, guardarBorrador, borrarBorrador } from '@/lib/historial/borrador';
import {
  TOMAS_OBLIGATORIAS, TOMAS_OPCIONALES, LADOS_CEDULA, ESTADOS_CHECK, itemsChecklist, validarActa, resumenActa,
} from '@/lib/historial/actas';
import { AVISO_TEXTO, AVISO_VERSION, CLAUSULA_RECEPCION, CLAUSULA_RECEPCION_VERSION } from '@/lib/portal/aviso';
import CamaraGuiada from './CamaraGuiada';
import Firma from './Firma';

/**
 * Entrega o recepción desde el celular del coordinador (R8-R27, R70-R73).
 * Un borrador por auto y tipo (R71), guardado en el teléfono a cada paso;
 * cada archivo sube apenas se acepta y el cierre espera a que estén todos.
 */
export default function Protocolo({ tipo, patente }) {
  const { t } = useLang();
  const clave = `acta:${tipo}:${patente}`;
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [b, setB] = useState(null);
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const subiendo = useRef(new Set());

  useEffect(() => {
    fetch(`/api/historial/actas/datos?tipo=${tipo}&patente=${encodeURIComponent(patente)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json().catch(() => ({}))).error || 'base')))
      .then(setDatos)
      .catch(setError);
  }, [tipo, patente]);

  useEffect(() => {
    if (!datos) return;
    leerBorrador(clave).then((g) => setB(g || {
      uid: crypto.randomUUID(),
      tipo,
      patente,
      iniciado: new Date().toISOString(),
      // R10: el acta conserva la checklist con que se abrió, aunque cambie después.
      checklistVersion: datos.checklist.version,
      checklistGrupos: datos.checklist.items,
      paso: 'conductor',
      conductor: null,
      cedula: {},
      fotos: {},
      libres: [],
      checklist: {},
      km: '',
      luces: false,
      comentario: '',
      firma: null,
    }));
  }, [datos, clave, tipo, patente]);

  const guardar = useCallback((cambio) => {
    setB((x) => {
      const nuevo = typeof cambio === 'function' ? cambio(x) : { ...x, ...cambio };
      guardarBorrador(clave, nuevo).catch(() => {});
      return nuevo;
    });
  }, [clave]);

  /** Sube un archivo y anota su ruta. `donde` dice en qué parte del borrador va. */
  const subir = useCallback(async (clase, parte, archivo, donde, uid) => {
    const id = `${clase}:${parte}`;
    if (!archivo?.blob || archivo.subida || subiendo.current.has(id)) return !!archivo?.subida;
    subiendo.current.add(id);
    try {
      const r = await fetch('/api/historial/actas/subir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, patente, clase, parte, tamano: archivo.blob.size }),
      });
      if (!r.ok) return false;
      const { bucket, ruta, token } = await r.json();
      const { error: e } = await supabaseNavegador().storage.from(bucket)
        .uploadToSignedUrl(ruta, token, archivo.blob, { contentType: archivo.blob.type || 'image/jpeg', upsert: true });
      if (e) return false;
      guardar((x) => donde(x, { ruta, subida: true }));
      return true;
    } catch (_) {
      return false;
    } finally {
      subiendo.current.delete(id);
    }
  }, [guardar, patente]);

  // Lo que se sube y dónde se anota, para el borrador actual.
  const subidas = useCallback((x) => [
    ...Object.entries(x.fotos).filter(([, f]) => f.blob).map(([toma, f]) => ['foto', toma, f,
      (y, m) => ({ ...y, fotos: { ...y.fotos, [toma]: { ...y.fotos[toma], ...m } } })]),
    ...x.libres.map((f, i) => ['foto', `libre-${i + 1}`, f,
      (y, m) => ({ ...y, libres: y.libres.map((l, j) => (j === i ? { ...l, ...m } : l)) })]),
    ...Object.entries(x.cedula).map(([lado, f]) => ['cedula', lado, f,
      (y, m) => ({ ...y, cedula: { ...y.cedula, [lado]: { ...y.cedula[lado], ...m } } })]),
    ...(x.firma ? [['firma', 'firma', x.firma, (y, m) => ({ ...y, firma: { ...y.firma, ...m } })]] : []),
  ], []);

  // Al retomar un borrador, sube lo que quedó pendiente.
  useEffect(() => {
    if (!b) return;
    for (const [clase, parte, f, donde] of subidas(b)) if (!f.subida) subir(clase, parte, f, donde, b.uid);
  }, [b?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => itemsChecklist({ items: b?.checklistGrupos }), [b?.checklistGrupos]);

  if (error) return <Aviso texto={t(error === 'no_existe' ? 'hv_no_existe' : error === 'sin_permiso' ? 'pr_sin_permiso' : 'hv_error')} t={t} />;
  if (!datos || !b) return <p className="text-gray-500">{t('hv_cargando')}</p>;

  const pideCedula = tipo === 'entrega' && !(b.conductor?.id && b.conductor.cedulaRegistrada);
  const actaParaValidar = { ...b, pideCedula, conductor: b.conductor };
  const btn = 'min-h-[52px] w-full rounded-xl px-4 text-base font-bold transition disabled:opacity-40';
  const textosCamara = {
    encendiendo: t('pr_cam_encendiendo'), sinCamara: t('pr_cam_sin'), tomar: t('pr_cam_tomar'), procesando: t('pr_cam_procesando'),
    repetir: t('pr_cam_repetir'), aceptar: t('pr_cam_aceptar'), camaraNativa: t('pr_cam_nativa'), noSePudo: t('pr_cam_no_se_pudo'),
    motivo: t('pr_cam_motivo'), motivoEjemplo: t('pr_cam_motivo_ej'), volver: t('pr_cam_volver'), guardarMotivo: t('pr_cam_guardar'),
    verAnterior: t('pr_cam_ver_ref'), ocultarAnterior: t('pr_cam_ocultar_ref'),
  };
  const titulo = `${t(`ev_${tipo}`)} · ${patente}`;

  // ── Cámara de una toma, de un lado de la cédula o de una foto libre ──
  if (b.paso.startsWith('camara:')) {
    const parte = b.paso.slice(7);
    const volver = parte.startsWith('cedula') ? 'cedula' : 'fotos';
    const obligatoria = TOMAS_OBLIGATORIAS.includes(parte);
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => guardar({ paso: volver })} className="text-sm font-semibold text-gray-500">← {t('pr_volver')}</button>
        <CamaraGuiada
          key={parte}
          toma={parte}
          titulo={t(parte === 'libre' ? 'pr_foto_libre' : `toma_${parte}`)}
          ayuda={parte === 'libre' ? t('pr_foto_libre_ayuda') : obligatoria ? t('pr_obligatoria') : null}
          anterior={tipo === 'recepcion' ? datos.referencia?.fotos?.[parte] || null : null}
          textos={textosCamara}
          onAceptar={(foto) => {
            if (parte === 'libre') {
              const i = b.libres.length;
              guardar((x) => ({ ...x, paso: 'fotos', libres: [...x.libres, { ...foto, subida: false, comentario: '' }] }));
              subir('foto', `libre-${i + 1}`, foto, (y, m) => ({ ...y, libres: y.libres.map((l, j) => (j === i ? { ...l, ...m } : l)) }), b.uid);
            } else if (parte.startsWith('cedula')) {
              guardar((x) => ({ ...x, paso: 'cedula', cedula: { ...x.cedula, [parte]: { ...foto, subida: false } } }));
              subir('cedula', parte, foto, (y, m) => ({ ...y, cedula: { ...y.cedula, [parte]: { ...y.cedula[parte], ...m } } }), b.uid);
            } else {
              guardar((x) => ({ ...x, paso: 'fotos', fotos: { ...x.fotos, [parte]: { ...foto, subida: false, dano: x.fotos[parte]?.dano } } }));
              subir('foto', parte, foto, (y, m) => ({ ...y, fotos: { ...y.fotos, [parte]: { ...y.fotos[parte], ...m } } }), b.uid);
            }
          }}
          onNoSePudo={obligatoria ? (motivo) => guardar((x) => ({ ...x, paso: 'fotos', fotos: { ...x.fotos, [parte]: { noSePudo: true, motivo } } })) : null}
        />
      </div>
    );
  }

  // ── Firma del conductor (pantalla completa y bloqueada) ──
  if (b.paso === 'firma') {
    return (
      <Firma
        textos={{ titulo: 'Firma del conductor', ayuda: `${b.conductor?.nombre || b.conductor?.provisional?.nombre || ''} · ${titulo}`, volver: 'Volver', borrar: 'Borrar', firmar: 'Firmar' }}
        onCancelar={() => guardar({ paso: 'resumen' })}
        onFirmar={(f) => {
          guardar((x) => ({ ...x, paso: 'cerrar', firma: { ...f, subida: false } }));
          subir('firma', 'firma', f, (y, m) => ({ ...y, firma: { ...y.firma, ...m } }), b.uid);
        }}
      />
    );
  }

  async function cerrar() {
    setEnviando(true);
    setAviso('');
    try {
      const actual = (await leerBorrador(clave)) || b;
      for (const [clase, parte, f, donde] of subidas(actual)) {
        if (!f.subida && !(await subir(clase, parte, f, donde, actual.uid))) {
          setAviso(t('pr_sin_senal'));
          return;
        }
      }
      const listo = (await leerBorrador(clave)) || actual;
      const sinBlob = (f) => f && (f.noSePudo ? { noSePudo: true, motivo: f.motivo } : { ruta: f.ruta, sha256: f.sha256, tomadaEn: f.tomadaEn, dano: f.dano || undefined });
      const r = await fetch('/api/historial/actas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: listo.uid, tipo, patente, iniciado: listo.iniciado, checklistVersion: listo.checklistVersion,
          conductor: listo.conductor?.id ? { id: listo.conductor.id } : listo.conductor,
          cedula: Object.fromEntries(Object.entries(listo.cedula).map(([k, f]) => [k, sinBlob(f)])),
          fotos: Object.fromEntries(Object.entries(listo.fotos).map(([k, f]) => [k, sinBlob(f)])),
          libres: listo.libres.map((f) => ({ ...sinBlob(f), comentario: f.comentario })),
          checklist: listo.checklist, km: Number(listo.km), luces: listo.luces, comentario: listo.comentario,
          firma: listo.sinFirma ? null : { ruta: listo.firma.ruta, sha256: listo.firma.sha256, firmadaEn: listo.firma.firmadaEn },
          sinFirma: listo.sinFirma || undefined,
          clausula: tipo === 'entrega' ? CLAUSULA_RECEPCION_VERSION : undefined,
          aviso: AVISO_VERSION,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        await borrarBorrador(clave);
        setB({ ...listo, paso: 'listo', resultado: j });
        return;
      }
      if (j.error === 'archivos_sin_subir') {
        guardar((x) => {
          const y = { ...x };
          for (const [, parte, , donde] of subidas(x)) if (j.faltan.includes(parte)) Object.assign(y, donde(y, { subida: false }));
          return y;
        });
        setAviso(t('pr_faltan_archivos'));
      } else setAviso(t('pr_error_envio'));
    } catch (_) {
      setAviso(t('pr_sin_senal'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5 text-gray-900">
      <div>
        <h1 className="text-2xl font-extrabold">{titulo}</h1>
        <p className="text-sm text-gray-500">{[datos.auto.marca, datos.auto.modelo, datos.auto.color].filter(Boolean).join(' · ')}</p>
      </div>

      {b.paso === 'conductor' && (
        <PasoConductor tipo={tipo} datos={datos} b={b} t={t} btn={btn}
          onElegir={(conductor) => guardar({ conductor, paso: tipo === 'entrega' && !(conductor.id && conductor.cedulaRegistrada) ? 'cedula' : 'fotos' })} />
      )}

      {b.paso === 'cedula' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">{t('pr_cedula')}</h2>
          <p className="text-sm text-gray-600">{t('pr_cedula_ayuda')}</p>
          <div className="grid grid-cols-2 gap-3">
            {LADOS_CEDULA.map((lado) => (
              <Casilla key={lado} etiqueta={t(`toma_${lado}`)} foto={b.cedula[lado]} t={t} onClick={() => guardar({ paso: `camara:${lado}` })} />
            ))}
          </div>
          <button type="button" disabled={LADOS_CEDULA.some((l) => !b.cedula[l])} onClick={() => guardar({ paso: 'fotos' })} className={`${btn} bg-gray-900 text-white`}>{t('pr_seguir')}</button>
          <button type="button" onClick={() => guardar({ paso: 'conductor' })} className="w-full py-2 text-sm font-semibold text-gray-500 underline">{t('pr_volver')}</button>
        </div>
      )}

      {b.paso === 'fotos' && (
        <PasoFotos tipo={tipo} b={b} datos={datos} t={t} btn={btn} guardar={guardar}
          onSeguir={() => guardar({ paso: 'checklist' })}
          onVolver={() => guardar({ paso: pideCedula ? 'cedula' : 'conductor' })} />
      )}

      {b.paso === 'checklist' && (
        <PasoChecklist b={b} t={t} btn={btn} guardar={guardar} items={items}
          onSeguir={() => guardar({ paso: 'lecturas' })} onVolver={() => guardar({ paso: 'fotos' })} />
      )}

      {b.paso === 'lecturas' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="km" className="mb-1 block font-bold">{t('pr_km')}</label>
            <input id="km" inputMode="numeric" value={b.km} onChange={(e) => guardar({ km: e.target.value.replace(/\D/g, '').slice(0, 7) })}
              className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 text-2xl tracking-wider" />
            {datos.ultimoKm != null && b.km !== '' && Number(b.km) < datos.ultimoKm && (
              <p className="mt-1 text-sm font-semibold text-amber-700">{t('pr_km_menor')(datos.ultimoKm.toLocaleString('es-CL'))}</p>
            )}
          </div>
          <label className="flex items-center gap-3 rounded-xl border-2 border-gray-200 p-3">
            <input type="checkbox" checked={b.luces} onChange={(e) => guardar({ luces: e.target.checked })} className="h-6 w-6" />
            {t('pr_luces')}
          </label>
          <div>
            <label htmlFor="com" className="mb-1 block font-bold">{t('pr_comentario')}</label>
            <textarea id="com" rows={3} value={b.comentario} onChange={(e) => guardar({ comentario: e.target.value.slice(0, 1000) })} className="w-full rounded-xl border-2 border-gray-300 p-3" />
          </div>
          <button type="button" disabled={validarActa(actaParaValidar, items, { conFirma: false }).length > 0} onClick={() => guardar({ paso: 'resumen' })} className={`${btn} bg-gray-900 text-white`}>{t('pr_seguir')}</button>
          <button type="button" onClick={() => guardar({ paso: 'checklist' })} className="w-full py-2 text-sm font-semibold text-gray-500 underline">{t('pr_volver')}</button>
        </div>
      )}

      {b.paso === 'resumen' && (
        <PasoResumen tipo={tipo} b={b} items={items} btn={btn} t={t}
          onFirmar={() => guardar({ paso: 'firma', sinFirma: null })} onVolver={() => guardar({ paso: 'lecturas' })}
          onSinFirma={() => guardar({ paso: 'sin_firma' })} />
      )}

      {b.paso === 'sin_firma' && (
        <PasoSinFirma b={b} t={t} btn={btn}
          onConfirmar={(sinFirma) => guardar({ sinFirma, firma: null, paso: 'cerrar' })}
          onVolver={() => guardar({ paso: 'resumen' })} />
      )}

      {b.paso === 'cerrar' && (
        <div className="space-y-4">
          <p className="text-lg font-bold">{b.sinFirma ? t('pr_cerrar_sin_firma') : t('pr_firmada')}</p>
          {aviso && <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 font-semibold text-amber-800">{aviso}</p>}
          <button type="button" disabled={enviando} onClick={cerrar} className={`${btn} bg-emerald-600 text-white`}>{enviando ? t('pr_enviando') : t('pr_cerrar')}</button>
          <button type="button" disabled={enviando} onClick={() => guardar(b.sinFirma ? { paso: 'resumen', sinFirma: null } : { paso: 'firma', firma: null })}
            className="w-full py-2 text-sm font-semibold text-gray-500 underline">{t(b.sinFirma ? 'pr_volver' : 'pr_firmar_de_nuevo')}</button>
        </div>
      )}

      {b.paso === 'listo' && (
        <div className="space-y-4">
          <p className="text-2xl font-extrabold text-emerald-700">✓ {t('pr_listo')}</p>
          <p className="text-gray-600">{b.resultado?.pdf ? t('pr_listo_pdf') : t('pr_listo_sin_pdf')}</p>
          <Link href={`/historial?p=${patente}`} className={`${btn} flex items-center justify-center bg-gray-900 text-white`}>{t('pr_ver_ficha')}</Link>
          <Link href="/m" className={`${btn} flex items-center justify-center border-2 border-gray-300`}>{t('pr_otra')}</Link>
        </div>
      )}

      {!['listo', 'cerrar'].includes(b.paso) && (
        <button type="button" onClick={async () => { if (window.confirm(t('pr_descartar_confirmar'))) { await borrarBorrador(clave); window.location.href = '/m'; } }}
          className="w-full pt-4 text-sm text-red-600 underline">{t('pr_descartar')}</button>
      )}
    </div>
  );
}

function Aviso({ texto, t }) {
  return (
    <div className="space-y-3">
      <p className="text-lg font-semibold">{texto}</p>
      <Link href="/m" className="text-sm underline">{t('pr_volver')}</Link>
    </div>
  );
}

function Casilla({ etiqueta, foto, t, onClick, opcional }) {
  const url = useMemo(() => (foto?.blob ? URL.createObjectURL(foto.blob) : null), [foto?.blob]);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <div className={`flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl ${foto ? 'bg-gray-200' : opcional ? 'border-2 border-dashed border-gray-300' : 'border-2 border-dashed border-amber-400 bg-amber-50'}`}>
        {url ? <img src={url} alt="" className="h-full w-full object-cover" />
          : foto?.noSePudo ? <span className="p-2 text-center text-xs text-gray-500">{t('pr_no_se_pudo')}</span>
            : <span className="text-2xl text-gray-400">＋</span>}
      </div>
      <p className="mt-1 text-xs font-semibold leading-tight">{etiqueta}</p>
      {foto?.blob && <p className="text-[11px] text-gray-500">{foto.subida ? `✓ ${t('pr_subida')}` : t('pr_subiendo')}</p>}
    </button>
  );
}

function PasoConductor({ tipo, datos, b, t, btn, onElegir }) {
  const [modo, setModo] = useState(datos.propuesto ? 'propuesto' : tipo === 'entrega' ? 'elegir' : 'elegir');
  const [busqueda, setBusqueda] = useState('');
  const [prov, setProv] = useState(b.conductor?.provisional || { nombre: '', rut: '', telefono: '' });
  const p = datos.propuesto;
  const horas = datos.ultimaCarga ? Math.round((Date.now() - Date.parse(datos.ultimaCarga)) / 3600000) : null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">{t(tipo === 'entrega' ? 'pr_quien_recibe' : 'pr_quien_devuelve')}</h2>
      {modo === 'propuesto' && p && (
        <>
          <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
            <p className="text-xl font-extrabold">{p.nombre}</p>
            <p className="text-sm text-gray-600">{p.rut || t('hv_rut_invalido')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('pr_segun_fleet')(horas)}</p>
            {tipo === 'entrega' && <p className="mt-1 text-xs text-gray-500">{p.cedulaRegistrada ? t('pr_cedula_ok') : t('pr_cedula_falta')}</p>}
          </div>
          <button type="button" onClick={() => onElegir({ id: p.id, nombre: p.nombre, cedulaRegistrada: p.cedulaRegistrada })} className={`${btn} bg-gray-900 text-white`}>{t('pr_confirmar')}</button>
          {tipo === 'entrega' && <button type="button" onClick={() => setModo('elegir')} className={`${btn} border-2 border-gray-300`}>{t('pr_otro')}</button>}
        </>
      )}
      {modo !== 'propuesto' && !p && tipo === 'recepcion' && <p className="text-gray-600">{t('pr_sin_conductor_recepcion')}</p>}
      {modo === 'elegir' && tipo === 'entrega' && (
        <>
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={t('pr_buscar_conductor')}
            className="w-full rounded-xl border-2 border-gray-300 px-4 py-3" />
          <ul className="max-h-72 divide-y overflow-y-auto rounded-xl border-2 border-gray-200 bg-white">
            {(datos.conductores || []).filter((c) => !busqueda || c.nombre.toUpperCase().includes(busqueda.toUpperCase())).slice(0, 50).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onElegir({ id: c.id, nombre: c.nombre, cedulaRegistrada: c.cedulaRegistrada })} className="w-full px-4 py-3 text-left">
                  <span className="font-semibold">{c.nombre}</span>
                  {c.patentes?.length > 0 && <span className="ml-2 text-xs text-gray-500">{c.patentes.join(', ')}</span>}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setModo('provisional')} className={`${btn} border-2 border-gray-300`}>{t('pr_provisional')}</button>
          {p && <button type="button" onClick={() => setModo('propuesto')} className="w-full py-2 text-sm underline">{t('pr_volver')}</button>}
        </>
      )}
      {modo === 'provisional' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{t('pr_provisional_ayuda')}</p>
          {['nombre', 'rut', 'telefono'].map((k) => (
            <input key={k} value={prov[k]} onChange={(e) => setProv({ ...prov, [k]: e.target.value })} placeholder={t(`pr_prov_${k}`)}
              inputMode={k === 'telefono' ? 'tel' : 'text'} className="w-full rounded-xl border-2 border-gray-300 px-4 py-3" />
          ))}
          <button type="button" disabled={!prov.nombre.trim() || !prov.rut.trim()} onClick={() => onElegir({ provisional: prov, nombre: prov.nombre })} className={`${btn} bg-gray-900 text-white`}>{t('pr_confirmar')}</button>
          <button type="button" onClick={() => setModo('elegir')} className="w-full py-2 text-sm underline">{t('pr_volver')}</button>
        </div>
      )}
    </div>
  );
}

function PasoFotos({ tipo, b, datos, t, btn, guardar, onSeguir, onVolver }) {
  const faltan = TOMAS_OBLIGATORIAS.filter((x) => !b.fotos[x]);
  const marcarDano = (toma, texto) => guardar((x) => ({ ...x, fotos: { ...x.fotos, [toma]: { ...x.fotos[toma], dano: texto } } }));
  const fichaToma = (toma, opcional) => (
    <div key={toma}>
      <Casilla etiqueta={t(`toma_${toma}`)} foto={b.fotos[toma]} t={t} opcional={opcional} onClick={() => guardar({ paso: `camara:${toma}` })} />
      {tipo === 'recepcion' && b.fotos[toma]?.blob && (
        <input value={b.fotos[toma].dano || ''} onChange={(e) => marcarDano(toma, e.target.value.slice(0, 300))} placeholder={t('pr_dano_nuevo')}
          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-xs" />
      )}
    </div>
  );
  return (
    <div className="space-y-4">
      {tipo === 'recepcion' && (
        <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
          {datos.referencia ? t('pr_referencia')(t(`ev_${datos.referencia.tipo}`)) : t('pr_sin_referencia')}
        </p>
      )}
      <h2 className="text-lg font-bold">{t('pr_fotos_obligatorias')}</h2>
      <div className="grid grid-cols-2 gap-3">{TOMAS_OBLIGATORIAS.map((x) => fichaToma(x, false))}</div>
      <h2 className="text-lg font-bold">{t('pr_fotos_opcionales')}</h2>
      <div className="grid grid-cols-3 gap-2">{TOMAS_OPCIONALES.map((x) => fichaToma(x, true))}</div>
      <h2 className="text-lg font-bold">{t('pr_fotos_libres')}</h2>
      <div className="space-y-2">
        {b.libres.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-20 shrink-0"><Casilla etiqueta="" foto={l} t={t} onClick={() => {}} /></div>
            <input value={l.comentario} onChange={(e) => guardar((x) => ({ ...x, libres: x.libres.map((y, j) => (j === i ? { ...y, comentario: e.target.value.slice(0, 300) } : y)) }))}
              placeholder={t('pr_foto_libre_comentario')} className="flex-1 rounded-lg border border-gray-300 px-2 py-2 text-sm" />
          </div>
        ))}
        <button type="button" onClick={() => guardar({ paso: 'camara:libre' })} className="w-full rounded-xl border-2 border-dashed border-gray-300 py-3 text-sm font-semibold">＋ {t('pr_agregar_libre')}</button>
      </div>
      {faltan.length > 0 && <p className="text-sm font-semibold text-amber-700">{t('pr_faltan')(faltan.length)}</p>}
      <button type="button" disabled={faltan.length > 0} onClick={onSeguir} className={`${btn} bg-gray-900 text-white`}>{t('pr_seguir')}</button>
      <button type="button" onClick={onVolver} className="w-full py-2 text-sm font-semibold text-gray-500 underline">{t('pr_volver')}</button>
    </div>
  );
}

const COLOR_ESTADO = { ok: 'bg-emerald-600 text-white', falta: 'bg-amber-500 text-white', danado: 'bg-red-600 text-white', no_aplica: 'bg-gray-500 text-white' };

function PasoChecklist({ b, t, btn, guardar, items, onSeguir, onVolver }) {
  const marcar = (item, estado) => guardar((x) => ({ ...x, checklist: { ...x.checklist, [item]: { ...x.checklist[item], estado } } }));
  const comentar = (item, comentario) => guardar((x) => ({ ...x, checklist: { ...x.checklist, [item]: { ...x.checklist[item], comentario } } }));
  const sinMarcar = items.filter((i) => !b.checklist[i]?.estado);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('pr_checklist')}</h2>
        <button type="button" onClick={() => guardar((x) => ({ ...x, checklist: Object.fromEntries(items.map((i) => [i, { ...x.checklist[i], estado: x.checklist[i]?.estado || 'ok' }])) }))}
          className="text-sm font-semibold underline">{t('pr_resto_ok')}</button>
      </div>
      {b.checklistGrupos.map((g) => (
        <section key={g.grupo} className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">{g.grupo}</h3>
          {g.items.map((item) => {
            const r = b.checklist[item] || {};
            return (
              <div key={item} className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="mb-2 font-semibold">{item}</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {ESTADOS_CHECK.map((e) => (
                    <button key={e} type="button" onClick={() => marcar(item, e)}
                      className={`rounded-lg px-1 py-2 text-xs font-bold leading-tight ${r.estado === e ? COLOR_ESTADO[e] : 'bg-gray-100 text-gray-700'}`}>
                      {t(`pr_check_${e}`)}
                    </button>
                  ))}
                </div>
                {r.estado && !['ok', 'no_aplica'].includes(r.estado) && (
                  <input value={r.comentario || ''} onChange={(e) => comentar(item, e.target.value.slice(0, 200))} placeholder={t('pr_check_comentario')}
                    className="mt-2 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                )}
              </div>
            );
          })}
        </section>
      ))}
      <button type="button" disabled={sinMarcar.length > 0} onClick={onSeguir} className={`${btn} bg-gray-900 text-white`}>
        {sinMarcar.length ? t('pr_faltan')(sinMarcar.length) : t('pr_seguir')}
      </button>
      <button type="button" onClick={onVolver} className="w-full py-2 text-sm font-semibold text-gray-500 underline">{t('pr_volver')}</button>
    </div>
  );
}

const NOMBRE_TOMA_ES = {
  frente: 'Frente', trasera: 'Trasera', lateral_izquierdo: 'Costado izquierdo', lateral_derecho: 'Costado derecho', tablero: 'Tablero',
  esquina_del_izq: 'Esquina delantera izq.', esquina_del_der: 'Esquina delantera der.', esquina_tra_izq: 'Esquina trasera izq.',
  esquina_tra_der: 'Esquina trasera der.', llanta_del_izq: 'Llanta delantera izq.', llanta_del_der: 'Llanta delantera der.',
  llanta_tra_izq: 'Llanta trasera izq.', llanta_tra_der: 'Llanta trasera der.', interior_delantero: 'Interior delantero',
  interior_trasero: 'Interior trasero', maleta: 'Maleta', libre: 'Foto libre',
};

/** Resumen que lee el conductor antes de firmar (R73). En español: es para el conductor. */
function PasoResumen({ tipo, b, items, btn, t, onFirmar, onVolver, onSinFirma }) {
  const r = resumenActa(b, items);
  const nombre = b.conductor?.nombre || b.conductor?.provisional?.nombre;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
        <p className="text-lg font-extrabold">{tipo === 'entrega' ? 'Recibes este auto' : 'Devuelves este auto'}</p>
        <p className="text-gray-700">{nombre}</p>
        <p className="mt-2 text-2xl font-extrabold">{r.km.toLocaleString('es-CL')} km</p>
        {r.luces && <p className="font-semibold text-amber-700">Con luces de advertencia encendidas</p>}
        <p className="mt-2 text-sm">Checklist: <b>{r.checklist.ok}</b> OK · <b>{r.checklist.falta}</b> falta · <b>{r.checklist.danado}</b> dañado{r.checklist.no_aplica ? <> · <b>{r.checklist.no_aplica}</b> no aplica</> : null}</p>
        {r.faltantes.length > 0 && <p className="text-sm text-amber-700">Falta: {r.faltantes.join(', ')}</p>}
        {r.danados.length > 0 && <p className="text-sm text-amber-700">Dañado: {r.danados.join(', ')}</p>}
        {r.danos.length > 0 && (
          <div className="mt-2 text-sm text-red-700">
            <p className="font-semibold">Daños marcados:</p>
            {r.danos.map((d, i) => <p key={i}>• {NOMBRE_TOMA_ES[d.toma]}: {d.texto}</p>)}
          </div>
        )}
        {r.sinFoto.length > 0 && <p className="mt-2 text-sm text-gray-600">Sin foto: {r.sinFoto.map((s) => `${NOMBRE_TOMA_ES[s.toma]} (${s.motivo})`).join(', ')}</p>}
        {b.comentario && <p className="mt-2 text-sm text-gray-600">“{b.comentario}”</p>}
      </div>
      <div className="rounded-xl bg-gray-50 p-4 text-sm leading-relaxed text-gray-600">
        <p className="mb-1 font-bold text-gray-800">Cómo usamos tus datos</p>
        {AVISO_TEXTO.map((p) => <p key={p} className="mb-1">{p}</p>)}
      </div>
      {tipo === 'entrega' && (
        <div className="rounded-xl border-2 border-gray-300 bg-white p-4 text-sm leading-relaxed">
          <p className="mb-1 font-bold">Al firmar, también aceptas:</p>
          <p>{CLAUSULA_RECEPCION}</p>
        </div>
      )}
      <button type="button" onClick={onFirmar} className={`${btn} bg-emerald-600 text-white`}>{t('pr_pasar_firma')}</button>
      {tipo === 'recepcion' && (
        <button type="button" onClick={onSinFirma} className={`${btn} border-2 border-gray-300`}>{t('pr_sin_firma_btn')}</button>
      )}
      <button type="button" onClick={onVolver} className="w-full py-2 text-sm font-semibold text-gray-500 underline">{t('pr_volver')}</button>
    </div>
  );
}

/** Recepción sin el conductor: lo dejó botado o no quiso firmar. Motivo obligatorio. */
function PasoSinFirma({ b, t, btn, onConfirmar, onVolver }) {
  const [motivo, setMotivo] = useState(b.sinFirma?.motivo || '');
  const [testigo, setTestigo] = useState(b.sinFirma?.testigo || '');
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">{t('pr_sin_firma_titulo')}</h2>
      <p className="text-sm text-gray-600">{t('pr_sin_firma_ayuda')}</p>
      <div>
        <label htmlFor="motivo-sf" className="mb-1 block font-bold">{t('pr_sin_firma_motivo')}</label>
        <textarea id="motivo-sf" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
          placeholder={t('pr_sin_firma_ejemplo')} className="w-full rounded-xl border-2 border-gray-300 p-3" />
      </div>
      <div>
        <label htmlFor="testigo-sf" className="mb-1 block font-bold">{t('pr_sin_firma_testigo')}</label>
        <input id="testigo-sf" value={testigo} onChange={(e) => setTestigo(e.target.value.slice(0, 120))} className="w-full rounded-xl border-2 border-gray-300 px-4 py-3" />
      </div>
      <button type="button" disabled={motivo.trim().length < 5} onClick={() => onConfirmar({ motivo: motivo.trim(), testigo: testigo.trim() })}
        className={`${btn} bg-gray-900 text-white`}>{t('pr_sin_firma_confirmar')}</button>
      <button type="button" onClick={onVolver} className="w-full py-2 text-sm font-semibold text-gray-500 underline">{t('pr_volver')}</button>
    </div>
  );
}
