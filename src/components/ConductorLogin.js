'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ConductorLogin() {
  const [patente, setPatente] = useState('');
  const [rut, setRut] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const router = useRouter();

  async function enviar(e) {
    e.preventDefault();
    setError('');

    if (!patente.trim()) { setError('Escribe tu patente.'); return; }
    if (!rut.trim()) { setError('Escribe tu RUT.'); return; }

    setCargando(true);
    try {
      const res = await fetch('/api/conductor/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patente, rut }),
      });
      if (res.ok) {
        router.push('/conductores/mis-tags');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'No pudimos entrar. Intenta de nuevo.');
    } catch {
      setError('Sin conexión. Revisa tus datos móviles e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }

  const campo =
    'w-full rounded-xl border-2 border-gray-300 px-4 py-4 text-lg text-gray-900 ' +
    'placeholder-gray-400 focus:border-marca-azul focus:outline-none disabled:opacity-50';

  return (
    <form onSubmit={enviar} className="space-y-5">
      {error && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-base font-semibold text-red-700">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="patente" className="mb-2 block text-base font-bold text-gray-800">
          Patente de tu auto
        </label>
        <input
          id="patente"
          type="text"
          value={patente}
          onChange={(e) => setPatente(e.target.value.toUpperCase())}
          placeholder="ABCD12"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          disabled={cargando}
          className={`${campo} tracking-widest`}
        />
      </div>

      <div>
        <label htmlFor="rut" className="mb-2 block text-base font-bold text-gray-800">
          Tu RUT
        </label>
        <input
          id="rut"
          type="text"
          value={rut}
          onChange={(e) => setRut(e.target.value)}
          placeholder="12.345.678-9"
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          disabled={cargando}
          className={campo}
        />
        <p className="mt-2 text-sm text-gray-500">
          Puedes escribirlo con puntos o sin puntos, da lo mismo.
        </p>
      </div>

      <button
        type="submit"
        disabled={cargando}
        className="min-h-[56px] w-full rounded-xl bg-marca-azul px-4 py-4 text-lg font-bold
          text-white transition hover:bg-marca-azul-oscuro disabled:opacity-50"
      >
        {cargando ? 'Entrando…' : 'Ver mis TAG'}
      </button>
    </form>
  );
}
