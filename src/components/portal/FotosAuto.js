'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import CamaraGuiada from '@/components/historial/CamaraGuiada';
import { supabaseNavegador } from '@/lib/supabase/browser';
import { leerBorrador, guardarBorrador, borrarBorrador } from '@/lib/historial/borrador';
import { AVISO_TEXTO, AVISO_VERSION } from '@/lib/portal/aviso';

const TITULO = {
  frente: ['Frente del auto', 'Párate a unos 3 metros, de frente, con todo el auto dentro del dibujo.'],
  trasera: ['Parte trasera', 'Igual que el frente, desde atrás. Que se lea la patente.'],
  lateral_izquierdo: ['Costado izquierdo', 'El lado del conductor, completo, de rueda a rueda.'],
  lateral_derecho: ['Costado derecho', 'El lado del copiloto, completo, de rueda a rueda.'],
  tablero: ['Tablero con el auto encendido', 'Que se vea el kilometraje y las luces del tablero.'],
};

const TEXTOS = {
  encendiendo: 'Encendiendo la cámara…',
  sinCamara: 'No pudimos usar la cámara aquí. Usa el botón de abajo para sacar la foto con la cámara de tu teléfono.',
  tomar: 'Sacar foto',
  procesando: 'Preparando…',
  repetir: 'Repetir',
  aceptar: 'Usar esta foto',
  camaraNativa: 'Usar la cámara del teléfono',
  noSePudo: 'No puedo sacar esta foto',
  motivo: '¿Por qué no se puede?',
  motivoEjemplo: 'Ej: el auto está pegado a una pared',
  volver: 'Volver a la cámara',
  guardarMotivo: 'Guardar y seguir',
  verAnterior: 'Ver mi foto anterior',
  ocultarAnterior: 'Ocultar foto anterior',
};

const nuevoBorrador = (tipo) => ({ uid: crypto.randomUUID(), tipo, fotos: {}, km: '', luces: false, paso: 'intro' });

/**
 * Levantamiento o revisión del auto desde el portal (R28, R36, R74): 5 tomas
 * guiadas, km y luces, resumen con el aviso de privacidad y envío. Todo se
 * guarda en el teléfono; las fotos suben apenas se aceptan y el envío espera
 * a que estén todas arriba.
 */
export default function FotosAuto() {
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [b, setB] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const subiendo = useRef(new Set());
  const clave = estado && `fotos:${estado.patente}`;

  useEffect(() => {
    fetch('/api/conductor/fotos')
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json().catch(() => ({}))).error || 'interno')))
      .then(setEstado)
      .catch((e) => setError(e));
  }, []);

  useEffect(() => {
    if (!estado?.puede) return;
    leerBorrador(`fotos:${estado.patente}`).then((g) => setB(g && g.tipo === estado.tipo ? g : nuevoBorrador(estado.tipo)));
  }, [estado]);

  const guardar = useCallback((cambio) => {
    setB((actual) => {
      const nuevo = typeof cambio === 'function' ? cambio(actual) : { ...actual, ...cambio };
      guardarBorrador(clave, nuevo).catch(() => {});
      return nuevo;
    });
  }, [clave]);

  const subir = useCallback(async (toma, foto, uid) => {
    if (!foto?.blob || foto.subida || subiendo.current.has(toma)) return foto?.subida;
    subiendo.current.add(toma);
    try {
      const r = await fetch('/api/conductor/fotos/subir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, toma, tamano: foto.blob.size }),
      });
      if (!r.ok) return false;
      const { ruta, token } = await r.json();
      const { error: e } = await supabaseNavegador().storage.from('fotos')
        .uploadToSignedUrl(ruta, token, foto.blob, { contentType: 'image/jpeg', upsert: true });
      if (e) return false;
      guardar((x) => ({ ...x, fotos: { ...x.fotos, [toma]: { ...x.fotos[toma], ruta, subida: true } } }));
      return true;
    } catch (_) {
      return false;
    } finally {
      subiendo.current.delete(toma);
    }
  }, [guardar]);

  // Al retomar un borrador, sube lo que quedó pendiente.
  useEffect(() => {
    if (!b) return;
    for (const [t, f] of Object.entries(b.fotos)) if (f.blob && !f.subida) subir(t, f, b.uid);
  }, [b?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const urls = useMemo(() => {
    const m = {};
    for (const [t, f] of Object.entries(b?.fotos || {})) if (f.blob) m[t] = URL.createObjectURL(f.blob);
    return m;
  }, [b?.fotos]);
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls]);

  if (error) return <Mensaje titulo="No podemos mostrar tus fotos" texto={MENSAJE_ERROR[error] || MENSAJE_ERROR.interno} />;
  if (!estado) return <p className="text-lg text-gray-500">Cargando…</p>;
  if (!estado.vigente) return <Mensaje titulo="Ya no tienes este auto" texto="Solo el conductor que tiene el auto puede subir sus fotos." />;
  if (!estado.puede) {
    return <Mensaje titulo="Tus fotos están al día" texto={`Tu próxima revisión es el ${fechaLarga(estado.vence)}. Te avisaremos.`} />;
  }
  if (!b) return <p className="text-lg text-gray-500">Cargando…</p>;

  const tomas = estado.tomas;
  const indice = tomas.indexOf(b.paso);
  const hechas = tomas.filter((t) => b.fotos[t]).length;
  const nombre = estado.tipo === 'levantamiento' ? 'Fotos de tu auto' : 'Revisión mensual';

  async function enviar() {
    setEnviando(true);
    setAviso('');
    try {
      for (const t of tomas) {
        const f = b.fotos[t];
        if (f?.blob && !f.subida && !(await subir(t, f, b.uid))) {
          setAviso('Algunas fotos no se han podido subir. Revisa tu señal e intenta de nuevo; no se pierde nada.');
          return;
        }
      }
      const actual = await leerBorrador(clave) || b;
      const fotos = Object.fromEntries(tomas.map((t) => {
        const f = actual.fotos[t];
        return [t, f.noSePudo ? { noSePudo: true, motivo: f.motivo } : { ruta: f.ruta, sha256: f.sha256, tomadaEn: f.tomadaEn }];
      }));
      const r = await fetch('/api/conductor/fotos/enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: b.uid, km: Number(b.km), luces: b.luces, fotos, aviso: AVISO_VERSION }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        await borrarBorrador(clave);
        setB({ ...b, paso: 'enviado' });
        return;
      }
      if (j.error === 'fotos_sin_subir') {
        guardar((x) => ({ ...x, fotos: Object.fromEntries(Object.entries(x.fotos).map(([t, f]) => [t, j.faltan.includes(t) ? { ...f, subida: false } : f])) }));
        setAviso('Faltó subir alguna foto. Toca "Enviar" de nuevo.');
      } else setAviso('No pudimos enviar las fotos. Intenta de nuevo en un rato; quedan guardadas en tu teléfono.');
    } catch (_) {
      setAviso('Sin conexión. Tus fotos quedan guardadas en el teléfono; intenta de nuevo cuando tengas señal.');
    } finally {
      setEnviando(false);
    }
  }

  const botonGrande = 'min-h-[56px] w-full rounded-xl px-4 py-4 text-lg font-bold transition disabled:opacity-50';

  if (b.paso === 'enviado') {
    return (
      <Mensaje titulo="¡Listo, gracias!" texto="Recibimos las fotos de tu auto.">
        <Link href="/conductores/inicio" className={`${botonGrande} mt-6 block bg-marca-azul text-center text-white`}>Volver al inicio</Link>
      </Mensaje>
    );
  }

  if (b.paso === 'intro') {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-extrabold text-gray-900">{nombre}</h1>
        <p className="text-lg text-gray-600">
          Vamos a sacar 5 fotos de tu auto <b>{estado.patente}</b>: el frente, la parte trasera, los dos costados y el tablero con el kilometraje.
          Toma unos 5 minutos. Busca un lugar con luz.
        </p>
        {hechas > 0 && <p className="rounded-xl bg-amber-50 p-4 text-base text-amber-800">Ya llevas {hechas} de 5 fotos. Seguimos donde quedaste.</p>}
        <button type="button" onClick={() => guardar({ paso: tomas.find((t) => !b.fotos[t]) || 'km' })} className={`${botonGrande} bg-marca-azul text-white`}>
          {hechas > 0 ? 'Continuar' : 'Empezar'}
        </button>
      </div>
    );
  }

  if (indice >= 0) {
    const t = b.paso;
    const siguiente = tomas[indice + 1] || 'km';
    return (
      <div className="space-y-4 text-gray-900">
        <Progreso actual={indice + 1} total={tomas.length} />
        <CamaraGuiada
          key={t}
          toma={t}
          titulo={TITULO[t][0]}
          ayuda={TITULO[t][1]}
          anterior={estado.anteriores[t]}
          textos={TEXTOS}
          onAceptar={(foto) => {
            guardar((x) => ({ ...x, paso: siguiente, fotos: { ...x.fotos, [t]: { ...foto, subida: false } } }));
            subir(t, foto, b.uid);
          }}
          onNoSePudo={(motivo) => guardar((x) => ({ ...x, paso: siguiente, fotos: { ...x.fotos, [t]: { noSePudo: true, motivo } } }))}
        />
        {indice > 0 && (
          <button type="button" onClick={() => guardar({ paso: tomas[indice - 1] })} className="w-full py-2 text-base font-semibold text-gray-500 underline">
            Volver a la foto anterior
          </button>
        )}
      </div>
    );
  }

  if (b.paso === 'km') {
    const kmValido = /^\d{1,7}$/.test(String(b.km));
    return (
      <div className="space-y-5 text-gray-900">
        <Progreso actual={tomas.length} total={tomas.length} />
        <h2 className="text-2xl font-extrabold">Kilometraje</h2>
        <div>
          <label htmlFor="km" className="mb-2 block text-base font-bold">¿Cuántos km marca el tablero?</label>
          <input id="km" inputMode="numeric" value={b.km} onChange={(e) => guardar({ km: e.target.value.replace(/\D/g, '').slice(0, 7) })}
            placeholder="Ej: 45210" className="w-full rounded-xl border-2 border-gray-300 px-4 py-4 text-2xl tracking-wider focus:border-marca-azul focus:outline-none" />
        </div>
        <label className="flex items-center gap-3 rounded-xl border-2 border-gray-200 p-4 text-base">
          <input type="checkbox" checked={b.luces} onChange={(e) => guardar({ luces: e.target.checked })} className="h-6 w-6" />
          Hay luces de advertencia encendidas en el tablero
        </label>
        <button type="button" disabled={!kmValido} onClick={() => guardar({ paso: 'resumen' })} className={`${botonGrande} bg-marca-azul text-white`}>
          Seguir
        </button>
        <button type="button" onClick={() => guardar({ paso: tomas[tomas.length - 1] })} className="w-full py-2 text-base font-semibold text-gray-500 underline">
          Volver
        </button>
      </div>
    );
  }

  // Resumen antes de enviar (R73).
  return (
    <div className="space-y-5 text-gray-900">
      <h2 className="text-2xl font-extrabold">Revisa antes de enviar</h2>
      <ul className="grid grid-cols-2 gap-3">
        {tomas.map((t) => {
          const f = b.fotos[t];
          return (
            <li key={t}>
              <button type="button" onClick={() => guardar({ paso: t })} className="block w-full text-left">
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-gray-200">
                  {urls[t] ? <img src={urls[t]} alt="" className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center p-2 text-center text-xs text-gray-500">No se pudo: {f?.motivo}</div>}
                </div>
                <p className="mt-1 text-sm font-semibold">{TITULO[t][0]}</p>
                <p className="text-xs text-gray-500">{f?.noSePudo ? 'Sin foto' : f?.subida ? '✓ Subida' : 'Subiendo…'}</p>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-base"><b>{Number(b.km).toLocaleString('es-CL')} km</b>{b.luces ? ' · con luces de advertencia' : ''}</p>

      <div className="rounded-xl bg-gray-50 p-4 text-sm leading-relaxed text-gray-600">
        <p className="mb-1 font-bold text-gray-800">Cómo usamos tus fotos</p>
        {AVISO_TEXTO.map((p) => <p key={p} className="mb-1">{p}</p>)}
      </div>

      {aviso && <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-base font-semibold text-amber-800">{aviso}</p>}
      <button type="button" disabled={enviando} onClick={enviar} className={`${botonGrande} bg-emerald-600 text-white`}>
        {enviando ? 'Enviando…' : 'Enviar fotos'}
      </button>
      <button type="button" onClick={() => guardar({ paso: 'km' })} className="w-full py-2 text-base font-semibold text-gray-500 underline">Volver</button>
    </div>
  );
}

const MENSAJE_ERROR = {
  sin_ficha: 'No encontramos tu RUT en la flota. Habla con tu coordinador para revisarlo.',
  sin_auto: 'Este auto ya no aparece asignado a ti. Habla con tu coordinador.',
  interno: 'Tuvimos un problema. Intenta de nuevo en un rato.',
};

function Mensaje({ titulo, texto, children }) {
  return (
    <div>
      <h1 className="text-3xl font-extrabold text-gray-900">{titulo}</h1>
      <p className="mt-3 text-lg text-gray-600">{texto}</p>
      {children}
      {!children && <Link href="/conductores/inicio" className="mt-6 inline-block text-lg font-semibold text-marca-azul underline">Volver al inicio</Link>}
    </div>
  );
}

function Progreso({ actual, total }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-500">Paso {actual} de {total}</p>
      <div className="mt-1 h-2 rounded-full bg-gray-200">
        <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${(actual / total) * 100}%` }} />
      </div>
    </div>
  );
}

const fechaLarga = (f) => (f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) : '—');
