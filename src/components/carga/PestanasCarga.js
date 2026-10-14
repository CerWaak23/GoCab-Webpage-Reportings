'use client';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/useLang';

/** Carga de datos: subir exports | la maestra que se arma con ellos. */
export default function PestanasCarga({ vista }) {
  const { t } = useLang();
  const pestanas = [['archivos', '/carga', 'carga_pestana_archivos'], ['maestra', '/carga?vista=maestra', 'carga_pestana_maestra']];
  return (
    <nav className="mb-6 flex gap-1 border-b border-gray-800 text-sm">
      {pestanas.map(([k, href, clave]) => (
        <Link key={k} href={href}
          className={`-mb-px border-b-2 px-3 py-2 ${vista === k ? 'border-sky-400 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
          {t(clave)}
        </Link>
      ))}
    </nav>
  );
}
