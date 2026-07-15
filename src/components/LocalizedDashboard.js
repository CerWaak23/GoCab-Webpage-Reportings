'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { LANGS } from './LangSwitcher';

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

        {isManager && <Link
          href="/reports/financial"
          className="group flex items-center justify-between p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-green-500/40 hover:bg-gray-900/80 transition"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm">{t.financial_title}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t.financial_sub}</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-green-400 transition"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>}
      </div>
    </main>
  );
}
