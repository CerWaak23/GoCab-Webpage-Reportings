'use client';
import { useState, useEffect } from 'react';

export const LANGS = {
  es: {
    greeting: (name) => `Hola, ${name} 👋`,
    reports_label: 'Reportes disponibles',
    bills_title: 'Reporte de Bills',
    bills_sub: 'Cobros por conductor y vehículo · Pendientes y completados',
    financial_title: 'Reporte Financiero',
    financial_sub: 'Consolidado SumUp · Transacciones y balance de cuentas',
    tareas_title: 'Tareas Operacionales',
    tareas_sub: 'Mapa de tareas por proceso y persona · Editable en equipo',
    managers_badge: 'Gerentes',
    no_access: 'No tienes acceso a este reporte.',
  },
  en: {
    greeting: (name) => `Hello, ${name} 👋`,
    reports_label: 'Available reports',
    bills_title: 'Bills Report',
    bills_sub: 'Driver & vehicle charges · Pending and completed',
    financial_title: 'Financial Report',
    financial_sub: 'SumUp summary · Transactions and account balance',
    tareas_title: 'Operational Tasks',
    tareas_sub: 'Task map by process and person · Team-editable',
    managers_badge: 'Managers',
    no_access: 'You do not have access to this report.',
  },
  ru: {
    greeting: (name) => `Привет, ${name} 👋`,
    reports_label: 'Доступные отчёты',
    bills_title: 'Отчёт по счетам',
    bills_sub: 'Начисления по водителям и ТС · Ожидающие и завершённые',
    financial_title: 'Финансовый отчёт',
    financial_sub: 'Сводка SumUp · Транзакции и баланс счетов',
    tareas_title: 'Операционные задачи',
    tareas_sub: 'Карта задач по процессам и людям · Совместное редактирование',
    managers_badge: 'Менеджеры',
    no_access: 'У вас нет доступа к этому отчёту.',
  },
};

export default function LangSwitcher({ iframeSelector }) {
  const [lang, setLang] = useState('es');

  useEffect(() => {
    const saved = localStorage.getItem('gocab_lang') || 'es';
    setLang(saved);
  }, []);

  function switchLang(l) {
    setLang(l);
    localStorage.setItem('gocab_lang', l);
    window.dispatchEvent(new CustomEvent('gocab_lang_change', { detail: l }));

    // Sincronizar con el iframe si existe
    if (iframeSelector) {
      try {
        const iframe = document.querySelector(iframeSelector);
        const win = iframe?.contentWindow;
        if (win?.setLanguage) win.setLanguage(l);       // financial dashboard
        else if (win?.setLang) win.setLang(l);           // fleet debt report
      } catch (_) {}
    }
  }

  return (
    <div className="flex items-center gap-0.5 bg-gray-800/60 rounded-lg p-0.5 border border-gray-700/50">
      {['es', 'en', 'ru'].map(l => (
        <button
          key={l}
          onClick={() => switchLang(l)}
          className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide transition ${
            lang === l
              ? 'bg-green-500 text-white shadow'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
