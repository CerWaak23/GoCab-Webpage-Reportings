'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { LANGS } from './LangSwitcher';
import { puedeVerSeccion } from '@/lib/i18n/secciones';

export default function LocalizedDashboard({ firstName, role, isManager }) {
  const [lang, setLang] = useState('es');

  useEffect(() => {
    const saved = localStorage.getItem('gocab_lang') || 'es';
    setLang(saved);
    const handler = (e) => setLang(e.detail);
    window.addEventListener('gocab_lang_change', handler);
    return () => window.removeEventListener('gocab_lang_change', handler);
  }, []);

  const t = LANGS[lang] || LANGS.es;

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-10">
        <h2 className="text-2xl font-bold">{t.greeting(firstName)}</h2>
        <p className="text-gray-500 mt-1 text-sm">{role} · GoCab Chile</p>
      </div>

      <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-4">
        {t.reports_label}
      </p>

      <div className="flex flex-col gap-4">
        <Link
          href="/reports/bills"
          className="group flex items-center justify-between p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-blue-500/40 hover:bg-gray-900/80 transition"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm">{t.bills_title}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t.bills_sub}</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>

        <Link
          href="/reports/tareas"
          className="group flex items-center justify-between p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-amber-500/40 hover:bg-gray-900/80 transition"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm">{t.tareas_title}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t.tareas_sub}</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-amber-400 transition"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>

        {puedeVerSeccion(role, 'historial') && (
        <Link
          href="/historial"
          className="group flex items-center justify-between p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-500/40 hover:bg-gray-900/80 transition"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 7h8m-8 4h8m-8 4h5M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm">{t.historial_title}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t.historial_sub}</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-emerald-400 transition"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        )}

        {puedeVerSeccion(role, 'talleres') && (
        <Link
          href="/historial/talleres"
          className="group flex items-center justify-between p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-amber-500/40 hover:bg-gray-900/80 transition"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm">{t.talleres_title}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t.talleres_sub}</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-amber-400 transition"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        )}

        {puedeVerSeccion(role, 'carga') && (
        <Link
          href="/carga"
          className="group flex items-center justify-between p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-sky-500/40 hover:bg-gray-900/80 transition"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm">{t.carga_title}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t.carga_sub}</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-sky-400 transition"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        )}
      </div>
    </main>
  );
}
