'use client';
import { useState } from 'react';
import { useLang } from '@/lib/i18n/useLang';
import PeajesGps from '@/components/carga/PeajesGps';
import PeajesFacturas from '@/components/carga/PeajesFacturas';

/** Pestaña de peajes: el GPS contra lo cargado en Fleet | lo cobrado contra las facturas. */
export default function Peajes() {
  const { t } = useLang();
  const [vista, setVista] = useState('gps');
  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-lg border border-gray-800 bg-gray-900 p-0.5 text-sm">
        {[['gps', 'pf_vista_gps'], ['facturas', 'pf_vista_facturas']].map(([k, clave]) => (
          <button key={k} type="button" onClick={() => setVista(k)}
            className={`rounded-md px-3 py-1.5 ${vista === k ? 'bg-sky-500 font-semibold text-gray-950' : 'text-gray-400 hover:text-gray-200'}`}>
            {t(clave)}
          </button>
        ))}
      </div>
      {vista === 'gps' ? <PeajesGps /> : <PeajesFacturas />}
    </div>
  );
}
