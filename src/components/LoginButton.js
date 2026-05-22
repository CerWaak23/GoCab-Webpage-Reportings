'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginButton() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();

    if (!trimmed) {
      setError('Por favor ingresa tu email.');
      return;
    }
    if (!trimmed.endsWith('@gocab.io')) {
      setError('Solo se permiten cuentas @gocab.io.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });

      if (res.ok) {
        router.push('/dashboard');
      } else {
        const data = await res.json();
        setError(data.error || 'No tienes acceso al portal.');
      }
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          Email corporativo
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@gocab.io"
          disabled={loading}
          autoComplete="email"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3
            text-white text-sm placeholder-gray-600
            focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50
            disabled:opacity-50 transition"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !email}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl
          bg-green-500 hover:bg-green-400 active:bg-green-600
          disabled:opacity-40 disabled:cursor-not-allowed
          text-white font-semibold text-sm transition shadow-lg shadow-green-500/20"
      >
        {loading ? (
          <>
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Ingresando...
          </>
        ) : (
          'Ingresar'
        )}
      </button>
    </form>
  );
}
