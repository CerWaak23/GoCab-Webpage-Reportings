'use client';
import { useState, useEffect } from 'react';

export default function CurrencySwitcher({ iframeSelector }) {
  const [currency, setCurrencyState] = useState('CLP');

  useEffect(() => {
    const saved = localStorage.getItem('gocab_currency') || 'CLP';
    setCurrencyState(saved);
  }, []);

  function switchCurrency(c) {
    setCurrencyState(c);
    localStorage.setItem('gocab_currency', c);
    window.dispatchEvent(new CustomEvent('gocab_currency_change', { detail: c }));

    // Si hay un iframe en la página, llamar directamente a setCurrency()
    if (iframeSelector) {
      try {
        const iframe = document.querySelector(iframeSelector);
        if (iframe?.contentWindow?.setCurrency) {
          iframe.contentWindow.setCurrency(c);
        }
      } catch (_) {}
    }
  }

  return (
    <div className="flex items-center gap-0.5 bg-gray-800/60 rounded-lg p-0.5 border border-gray-700/50">
      {['CLP', 'USD'].map(c => (
        <button
          key={c}
          onClick={() => switchCurrency(c)}
          className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-wide transition ${
            currency === c
              ? 'bg-green-500 text-white shadow'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
