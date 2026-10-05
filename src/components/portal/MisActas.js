'use client';
import { useEffect, useState } from 'react';

const NOMBRE = { entrega: 'Entrega del auto', recepcion: 'Devolución del auto', levantamiento: 'Fotos de tu auto', revision: 'Revisión mensual' };

/** Mis actas (R14): historial del conductor, con descarga del PDF de entregas y devoluciones. */
export default function MisActas() {
  const [actas, setActas] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/conductor/actas').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => setActas(j.actas)).catch(() => setActas([]));
  }, []);

  async function descargar(id) {
    setError('');
    const r = await fetch(`/api/conductor/actas/pdf?id=${id}`);
    const j = await r.json().catch(() => ({}));
    if (j.url) window.location.href = j.url;
    else setError('No pudimos descargar el acta. Intenta de nuevo en un rato.');
  }

  if (!actas) return <p className="text-lg text-gray-500">Cargando…</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-extrabold text-gray-900">Mis actas</h1>
      {error && <p className="rounded-xl bg-red-50 p-3 font-semibold text-red-700">{error}</p>}
      {actas.length === 0 && <p className="text-lg text-gray-600">Todavía no tienes actas.</p>}
      <ul className="space-y-3">
        {actas.map((a) => (
          <li key={a.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-lg font-extrabold text-gray-900">{NOMBRE[a.tipo]}</p>
            <p className="text-base text-gray-600">
              {a.patente} · {new Date(a.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}
              {a.km != null && ` · ${a.km.toLocaleString('es-CL')} km`}
            </p>
            {a.sinFirma && <p className="text-sm text-amber-700">Recibida sin tu firma</p>}
            {a.pdf && (
              <button type="button" onClick={() => descargar(a.id)} className="mt-3 min-h-[48px] w-full rounded-xl bg-marca-azul px-4 font-bold text-white">
                Descargar PDF
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
