'use client';
import { useEffect, useState } from 'react';
import { ChipEstado, textoAlerta, fechaCorta, fechaHora, abrirArchivo } from './comun';

const PESTANAS = ['resumen', 'historia', 'fotos', 'documentos', 'pendientes', 'gastos'];

/** Ficha de un auto con pestañas (R3-R6). */
export default function Ficha({ patente, onVolver, t }) {
  const [ficha, setFicha] = useState(null);
  const [error, setError] = useState(null);
  const [pestana, setPestana] = useState('resumen');

  useEffect(() => {
    fetch(`/api/historial/vehiculos/${encodeURIComponent(patente)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setFicha)
      .catch((s) => setError(s === 404 ? 'hv_no_existe' : 'hv_error'));
  }, [patente]);

  const cabecera = (
    <button type="button" onClick={onVolver} className="lg:hidden mb-3 text-xs text-gray-400 hover:text-white">
      ← {t('hv_volver_lista')}
    </button>
  );
  if (error) return <div>{cabecera}<p className="text-sm text-red-400">{t(error)}</p></div>;
  if (!ficha) return <div>{cabecera}<p className="text-sm text-gray-500">{t('hv_cargando')}</p></div>;

  const { auto } = ficha;
  const cuenta = {
    historia: ficha.historia.length,
    fotos: ficha.archivos.filter((a) => a.clase === 'foto').length,
    documentos: ficha.archivos.filter((a) => a.clase !== 'foto').length,
    pendientes: ficha.pendientes.filter((p) => p.abierto).length,
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40">
      <div className="p-4 border-b border-gray-800">
        {cabecera}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-2xl font-bold tracking-wider">{auto.patente}</h2>
            <p className="text-sm text-gray-400">{[auto.marca, auto.modelo, auto.anio, auto.color].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <ChipEstado estado={ficha.estado} t={t} className="text-xs" />
            <span className="text-[11px] text-gray-500">Fleet: {auto.estado_fleet || '—'}{auto.modalidad ? ` · ${t(`modalidad_${auto.modalidad}`)}` : ''}</span>
          </div>
        </div>
      </div>

      <nav className="flex overflow-x-auto overflow-y-hidden border-b border-gray-800 px-2">
        {PESTANAS.map((p) => (
          <button key={p} type="button" onClick={() => setPestana(p)}
            className={`shrink-0 px-3 py-2.5 text-xs border-b-2 -mb-px transition ${pestana === p ? 'border-emerald-400 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {t(`hv_tab_${p}`)}{cuenta[p] ? <span className="ml-1 text-gray-500">{cuenta[p]}</span> : null}
          </button>
        ))}
      </nav>

      <div className="p-4">
        {pestana === 'resumen' && <Resumen ficha={ficha} t={t} />}
        {pestana === 'historia' && <Historia items={ficha.historia} t={t} />}
        {pestana === 'fotos' && <Fotos patente={auto.patente} hay={cuenta.fotos > 0} t={t} />}
        {pestana === 'documentos' && <Documentos archivos={ficha.archivos.filter((a) => a.clase !== 'foto')} hoy={ficha.hoy} t={t} />}
        {pestana === 'pendientes' && <Pendientes lista={ficha.pendientes} t={t} />}
        {pestana === 'gastos' && <Vacio texto={t('hv_gastos_pronto')} />}
      </div>
    </div>
  );
}

const Vacio = ({ texto }) => <p className="py-6 text-center text-xs text-gray-500">{texto}</p>;

function Dato({ etiqueta, children }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-500">{etiqueta}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}

function Resumen({ ficha, t }) {
  const { auto, conductor, vigente, alertas, revision } = ficha;
  return (
    <div className="space-y-5">
      {alertas.length > 0 && (
        <ul className="space-y-1">
          {alertas.map((a, i) => <li key={i} className="text-xs text-amber-300">⚠ {textoAlerta(a, t)}</li>)}
        </ul>
      )}

      <section>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">{t('hv_conductor_actual')}</h3>
        {conductor ? (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Dato etiqueta={t('hv_nombre')}>{conductor.nombre}</Dato>
            {ficha.contacto && <Dato etiqueta="RUT">{conductor.rut || <span className="text-amber-400">{t('hv_rut_invalido')}</span>}</Dato>}
            {ficha.contacto && <Dato etiqueta={t('hv_telefono')}>{conductor.telefono && <a href={`tel:${conductor.telefono}`} className="text-sky-400">{conductor.telefono}</a>}</Dato>}
            {ficha.contacto && <Dato etiqueta={t('hv_licencia')}>{conductor.licencia}</Dato>}
            {ficha.contacto && <Dato etiqueta={t('hv_vence_cedula')}>{conductor.vence_cedula && fechaCorta(conductor.vence_cedula)}</Dato>}
            <Dato etiqueta={t('hv_desde')}>
              {fechaCorta(vigente.desde)}
              {vigente.origen === 'preexistente' && <span className="block text-[11px] text-gray-500">{t('hv_preexistente')}</span>}
            </Dato>
          </dl>
        ) : <p className="text-sm text-gray-500">{t('hv_sin_conductor')}</p>}
      </section>

      {revision && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">{t('hv_revision')}</h3>
          <p className={`text-sm ${revision.vencida ? 'text-amber-300' : 'text-gray-300'}`}>
            {t('hv_revision_texto')(fechaCorta(revision.desde), fechaCorta(revision.vence))}
          </p>
        </section>
      )}

      <section>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">{t('hv_datos_auto')}</h3>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Dato etiqueta="VIN"><span className="font-mono text-xs break-all">{auto.vin}</span></Dato>
          <Dato etiqueta={t('hv_grupo')}>{auto.grupo}</Dato>
          <Dato etiqueta={t('hv_alta_fleet')}>{auto.creado_fleet && fechaCorta(auto.creado_fleet)}</Dato>
          <Dato etiqueta={t('hv_modalidad')}>{auto.modalidad ? t(`modalidad_${auto.modalidad}`) : <span className="text-gray-500">{t('hv_modalidad_sin')}</span>}</Dato>
        </dl>
      </section>
    </div>
  );
}

const PUNTO = {
  fleet_asigna: 'bg-gray-500', fleet_quita: 'bg-gray-600', ingreso: 'bg-sky-400', entrega: 'bg-emerald-400',
  recepcion: 'bg-teal-400', levantamiento: 'bg-yellow-400', revision: 'bg-lime-400', siniestro: 'bg-red-400', taller: 'bg-amber-400',
};

function Historia({ items, t }) {
  if (items.length === 0) return <Vacio texto={t('hv_historia_vacia')} />;
  return (
    <ol className="relative border-l border-gray-800 ml-1.5 space-y-4">
      {items.map((it) => (
        <li key={it.id} className="ml-4">
          <span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${PUNTO[it.tipo] || 'bg-gray-500'}`} />
          <p className="text-sm">
            {it.tipo === 'fleet_asigna' ? t('ev_fleet_asigna')(it.conductor)
              : it.tipo === 'fleet_quita' ? t('ev_fleet_quita')(it.conductor)
                : t(`ev_${it.tipo}`)}
            {it.conductor && !it.tipo.startsWith('fleet') && <span className="text-gray-400"> · {it.conductor}</span>}
          </p>
          <p className="text-[11px] text-gray-500">
            {fechaHora(it.fecha)}
            {it.origen === 'preexistente' && ` · ${t('hv_preexistente')}`}
            {it.reemplazo && ` · ${t('alerta_reemplazo')(it.reemplazaPatente)}`}
            {it.usuario && ` · ${it.usuario}`}
            {it.firmado && ` · ${t('hv_firmado')}`}
            {Number.isFinite(it.detalle?.km) && ` · ${it.detalle.km.toLocaleString('es-CL')} km`}
            {it.detalle?.luces && ` · ${t('hv_luces')}`}
            {it.detalle?.origen === 'portal' && ` · ${t('hv_desde_portal')}`}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Fotos({ patente, hay, t }) {
  const [fotos, setFotos] = useState(null);
  useEffect(() => {
    if (!hay) return;
    fetch(`/api/historial/fotos?patente=${encodeURIComponent(patente)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setFotos(j.fotos))
      .catch(() => setFotos([]));
  }, [patente, hay]);

  if (!hay) return <Vacio texto={t('hv_fotos_vacio')} />;
  if (!fotos) return <Vacio texto={t('hv_cargando')} />;
  // Por toma, de la más nueva a la más antigua: así se compara el auto en el tiempo (R5, R38).
  const porToma = new Map();
  for (const f of fotos) {
    const k = f.toma || 'libre';
    if (!porToma.has(k)) porToma.set(k, []);
    porToma.get(k).push(f);
  }
  return (
    <div className="space-y-5">
      {[...porToma].map(([toma, lista]) => (
        <section key={toma}>
          <h3 className="text-xs text-gray-400 mb-2">{t(`toma_${toma}`)} · {lista.length}</h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {lista.map((f) => (
              <a key={f.id} href={f.url || '#'} target="_blank" rel="noopener noreferrer" className="shrink-0 w-40">
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-gray-800">
                  {f.url && <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </div>
                <p className="mt-1 text-[11px] text-gray-500">{fechaHora(f.tomadaEn)}{f.evento ? ` · ${t(`ev_${f.evento}`)}` : ''}</p>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Documentos({ archivos, hoy, t }) {
  const [negado, setNegado] = useState(false);
  if (archivos.length === 0) return <Vacio texto={t('hv_documentos_vacio')} />;
  const abrir = async (id) => { if ((await abrirArchivo(id)) === 403) setNegado(true); };
  return (
    <div>
      {negado && <p className="mb-2 text-xs text-red-400">{t('hv_sin_permiso_archivo')}</p>}
      <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
        {archivos.map((a) => {
          const dias = a.vence ? Math.round((Date.parse(a.vence) - Date.parse(hoy)) / 86400000) : null;
          return (
            <li key={a.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{t(`doc_${a.metadatos?.tipo || a.clase}`)}</span>
              <span className="flex items-center gap-3 text-xs">
                {a.vence && (
                  <span className={dias < 0 ? 'text-red-400' : dias <= 30 ? 'text-amber-300' : 'text-gray-500'}>
                    {t('hv_vence')} {fechaCorta(a.vence)}
                  </span>
                )}
                <button type="button" onClick={() => abrir(a.id)} className="text-sky-400 hover:underline">{t('hv_ver')}</button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Pendientes({ lista, t }) {
  if (lista.length === 0) return <Vacio texto={t('hv_pendientes_vacio')} />;
  return (
    <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
      {lista.map((p) => (
        <li key={p.id} className={`px-3 py-2 text-sm ${p.abierto ? '' : 'opacity-50'}`}>
          <p>{p.texto}</p>
          <p className="text-[11px] text-gray-500">{fechaCorta(p.creado)} · {p.estado}{p.conductores?.nombre ? ` · ${p.conductores.nombre}` : ''}</p>
        </li>
      ))}
    </ul>
  );
}
