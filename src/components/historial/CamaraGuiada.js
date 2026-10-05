'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Silueta from './Siluetas';
import { comprimir, comprimirArchivo, sha256Hex } from '@/lib/historial/imagen';
import { MOTIVO_MINIMO } from '@/lib/historial/tomas';

/**
 * Cámara de una toma guiada (R8, R70): vista en vivo con la silueta, vista
 * previa con Repetir/Aceptar, cámara nativa del teléfono si no hay permiso o
 * falla, y "no se pudo tomar" con motivo. La cámara se apaga al salir.
 *
 * Textos en `textos` para usarla en el portal (español) y en GoBills (3 idiomas).
 */
export default function CamaraGuiada({ toma, titulo, ayuda, anterior, textos, onAceptar, onNoSePudo }) {
  const video = useRef(null);
  const flujo = useRef(null);
  const nativa = useRef(null);
  const [fase, setFase] = useState('iniciando'); // iniciando | viva | previa | sin_camara | no_se_pudo
  const [previa, setPrevia] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [verAnterior, setVerAnterior] = useState(false);

  const apagar = useCallback(() => {
    flujo.current?.getTracks().forEach((t) => t.stop());
    flujo.current = null;
  }, []);

  const encender = useCallback(async () => {
    setFase('iniciando');
    if (!navigator.mediaDevices?.getUserMedia) { setFase('sin_camara'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      flujo.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
      setFase('viva');
    } catch (_) {
      // Permiso denegado, cámara ocupada o navegador sin soporte.
      setFase('sin_camara');
    }
  }, []);

  useEffect(() => {
    encender();
    return apagar;
  }, [toma, encender, apagar]);

  useEffect(() => () => { if (previa?.url) URL.revokeObjectURL(previa.url); }, [previa]);

  async function preparar(resultado) {
    const sha256 = await sha256Hex(resultado.blob);
    setPrevia({ ...resultado, sha256, tomadaEn: new Date().toISOString(), url: URL.createObjectURL(resultado.blob) });
    setFase('previa');
  }

  async function disparar() {
    const v = video.current;
    if (!v?.videoWidth) return;
    setProcesando(true);
    try {
      await preparar(await comprimir(v, v.videoWidth, v.videoHeight));
      apagar();
    } finally {
      setProcesando(false);
    }
  }

  async function desdeNativa(e) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setProcesando(true);
    try {
      apagar();
      await preparar(await comprimirArchivo(archivo));
    } finally {
      setProcesando(false);
    }
  }

  const btn = 'min-h-[52px] rounded-xl px-4 text-base font-bold transition disabled:opacity-50';

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-extrabold">{titulo}</h2>
        {ayuda && <p className="text-sm opacity-75">{ayuda}</p>}
      </div>

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted className={`h-full w-full object-cover ${fase === 'viva' ? '' : 'hidden'}`} />
        {fase === 'previa' && previa && <img src={previa.url} alt="" className="h-full w-full object-cover" />}
        {fase === 'viva' && <Silueta toma={toma} />}
        {verAnterior && anterior && <img src={anterior} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
        {fase === 'iniciando' && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">{textos.encendiendo}</p>}
        {fase === 'sin_camara' && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/80">{textos.sinCamara}</p>
        )}
      </div>

      {anterior && fase === 'viva' && (
        <button type="button" onClick={() => setVerAnterior((x) => !x)} className="text-sm font-semibold underline opacity-80">
          {verAnterior ? textos.ocultarAnterior : textos.verAnterior}
        </button>
      )}

      {fase === 'viva' && (
        <button type="button" onClick={disparar} disabled={procesando} className={`${btn} w-full bg-emerald-500 text-white`}>
          {procesando ? textos.procesando : textos.tomar}
        </button>
      )}

      {fase === 'previa' && (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => { setPrevia(null); encender(); }} className={`${btn} border-2 border-current`}>
            {textos.repetir}
          </button>
          <button type="button" onClick={() => onAceptar({ blob: previa.blob, sha256: previa.sha256, tomadaEn: previa.tomadaEn })}
            className={`${btn} bg-emerald-500 text-white`}>
            {textos.aceptar}
          </button>
        </div>
      )}

      {(fase === 'viva' || fase === 'sin_camara') && (
        <button type="button" onClick={() => nativa.current?.click()} disabled={procesando}
          className={`${btn} w-full ${fase === 'sin_camara' ? 'bg-emerald-500 text-white' : 'border-2 border-current'}`}>
          {procesando && fase === 'sin_camara' ? textos.procesando : textos.camaraNativa}
        </button>
      )}
      <input ref={nativa} type="file" accept="image/*" capture="environment" className="hidden" onChange={desdeNativa} />

      {onNoSePudo && fase !== 'previa' && fase !== 'no_se_pudo' && (
        <button type="button" onClick={() => { apagar(); setFase('no_se_pudo'); }} className="w-full py-2 text-sm font-semibold underline opacity-70">
          {textos.noSePudo}
        </button>
      )}

      {fase === 'no_se_pudo' && (
        <div className="space-y-3">
          <label className="block text-sm font-bold">{textos.motivo}</label>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
            className="w-full rounded-xl border-2 border-gray-300 p-3 text-base text-gray-900" placeholder={textos.motivoEjemplo} />
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={encender} className={`${btn} border-2 border-current`}>{textos.volver}</button>
            <button type="button" disabled={motivo.trim().length < MOTIVO_MINIMO} onClick={() => onNoSePudo(motivo.trim())}
              className={`${btn} bg-gray-800 text-white`}>
              {textos.guardarMotivo}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
