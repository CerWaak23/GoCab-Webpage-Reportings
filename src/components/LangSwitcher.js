'use client';
import { useState, useEffect } from 'react';

// Los textos viven en src/lib/i18n/dict.js; se reexportan para no romper imports existentes.
export { LANGS } from '@/lib/i18n/dict';

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
