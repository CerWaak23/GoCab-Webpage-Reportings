'use client';
import { useRouter } from 'next/navigation';

/** Cierra la sesión del portal de conductores y vuelve al ingreso. */
export default function Salir({ className = 'text-base font-semibold text-gray-500' }) {
  const router = useRouter();
  async function salir() {
    await fetch('/api/conductor/logout', { method: 'POST' });
    router.push('/conductores');
    router.refresh();
  }
  return <button type="button" onClick={salir} className={className}>Salir</button>;
}
