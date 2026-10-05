'use client';
import Link from 'next/link';

/**
 * Pestañas del Historial (solo consulta): la lista de autos con su ficha y
 * la vista en el tiempo. Lo que se registra está en Registros.
 */
export default function PestanasHistorial({ actual, t }) {
  const pestanas = [
    { id: 'autos', href: '/historial', texto: t('hv_pestana_autos') },
    { id: 'tiempo', href: '/historial/tiempo', texto: t('hv_tiempo') },
  ];
  return (
    <nav className="mb-4 flex gap-1 border-b border-gray-800">
      {pestanas.map((p) => (
        <Link key={p.id} href={p.href}
          className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${actual === p.id ? 'border-emerald-400 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
          {p.texto}
        </Link>
      ))}
    </nav>
  );
}
