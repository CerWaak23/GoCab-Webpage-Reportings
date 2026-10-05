'use client';
import Link from 'next/link';
import LangSwitcher from '@/components/LangSwitcher';
import LogoutButton from '@/components/LogoutButton';
import { useLang } from '@/lib/i18n/useLang';

/**
 * Cabecera y cuerpo de las secciones nuevas (Historial, Carga de datos).
 * Mismo breadcrumb que src/app/reports/tareas/page.js, pero con textos
 * traducidos porque estas secciones son React y no un iframe.
 */
export default function SeccionNueva({ tituloClave, color = 'emerald', ancho = false, children }) {
  const { t } = useLang();
  const fondo = color === 'sky' ? 'bg-sky-500/20' : 'bg-emerald-500/20';
  const punto = color === 'sky' ? 'bg-sky-400' : 'bg-emerald-400';

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="border-b border-gray-800/60 bg-gray-950/80 backdrop-blur sticky top-0 z-10 shrink-0">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/dashboard" className="flex items-center gap-1.5 text-gray-500 hover:text-white transition text-xs shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {t('volver_dashboard')}
            </Link>
            <span className="text-gray-700">/</span>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-5 h-5 rounded ${fondo} flex items-center justify-center shrink-0`}>
                <span className={`w-2 h-2 rounded-full ${punto}`} />
              </span>
              <h1 className="text-sm font-semibold truncate">{t(tituloClave)}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <LangSwitcher />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className={`flex-1 px-4 sm:px-6 py-6 w-full mx-auto ${ancho ? 'max-w-7xl' : 'max-w-5xl'}`}>
        {children ?? <p className="text-gray-400 text-sm">{t('en_construccion')}</p>}
      </main>
    </div>
  );
}
