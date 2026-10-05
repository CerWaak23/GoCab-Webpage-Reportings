'use client';
import { useEffect, useRef, useState } from 'react';
import { sha256Hex } from '@/lib/historial/imagen';

/**
 * Firma del conductor en el teléfono del coordinador (R21, R25, R73). Ocupa
 * toda la pantalla y bloquea el scroll mientras se firma. Devuelve la imagen
 * PNG, su huella y los trazos (para reconstruirla si hiciera falta).
 */
export default function Firma({ textos, onFirmar, onCancelar }) {
  const lienzo = useRef(null);
  const trazos = useRef([]);
  const actual = useRef(null);
  const [vacia, setVacia] = useState(true);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const c = lienzo.current;
    const ajustar = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#111';
      redibujar();
    };
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener('resize', ajustar);
    };
  }, []);

  function redibujar() {
    const c = lienzo.current;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    for (const t of trazos.current) {
      g.beginPath();
      t.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  }

  const punto = (e) => {
    const r = lienzo.current.getBoundingClientRect();
    return [Math.round(e.clientX - r.left), Math.round(e.clientY - r.top)];
  };

  function bajar(e) {
    e.preventDefault();
    lienzo.current.setPointerCapture(e.pointerId);
    actual.current = [punto(e)];
    trazos.current.push(actual.current);
  }
  function mover(e) {
    if (!actual.current) return;
    e.preventDefault();
    const g = lienzo.current.getContext('2d');
    const [x0, y0] = actual.current[actual.current.length - 1];
    const p = punto(e);
    actual.current.push(p);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(p[0], p[1]);
    g.stroke();
    if (vacia) setVacia(false);
  }
  const soltar = () => { actual.current = null; };

  function borrar() {
    trazos.current = [];
    redibujar();
    setVacia(true);
  }

  async function firmar() {
    setGuardando(true);
    try {
      const blob = await new Promise((ok) => lienzo.current.toBlob(ok, 'image/png'));
      onFirmar({ blob, sha256: await sha256Hex(blob), trazos: trazos.current, firmadaEn: new Date().toISOString() });
    } finally {
      setGuardando(false);
    }
  }

  // Una firma de un solo toque no cuenta.
  const suficiente = !vacia && trazos.current.reduce((a, t) => a + t.length, 0) > 15;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-gray-900" style={{ touchAction: 'none' }}>
      <div className="p-4">
        <p className="text-xl font-extrabold">{textos.titulo}</p>
        <p className="text-sm text-gray-600">{textos.ayuda}</p>
      </div>
      <div className="relative mx-4 flex-1 rounded-2xl border-2 border-dashed border-gray-300">
        <canvas
          ref={lienzo}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: 'none' }}
          onPointerDown={bajar}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
        />
        <span className="pointer-events-none absolute bottom-8 left-6 right-6 border-b border-gray-300" />
      </div>
      <div className="grid grid-cols-3 gap-3 p-4">
        <button type="button" onClick={onCancelar} className="min-h-[52px] rounded-xl border-2 border-gray-300 font-bold">{textos.volver}</button>
        <button type="button" onClick={borrar} className="min-h-[52px] rounded-xl border-2 border-gray-300 font-bold">{textos.borrar}</button>
        <button type="button" onClick={firmar} disabled={!suficiente || guardando} className="min-h-[52px] rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-40">
          {textos.firmar}
        </button>
      </div>
    </div>
  );
}
