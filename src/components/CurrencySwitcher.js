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
    if (iframeSelector) {
      try {
        const iframe = document.querySelector(iframeSelector);
        const win = iframe && iframe.contentWindow;
        if (win && win.setCurrency) win.setCurrency(c);
      } catch (_) {}
    }
  }

  return (
    <div className="flex items-center gap-0.5 bg-gray-800/60 rounded-lg p-0.5 border border-gray-700/50">
      {['CLP', 'USD'].map(function(c) {
        return (
          <button
            key={c}
            onClick={function() { switchCurrency(c); }}
            className={'px-2.5 py-1 rounded-md text-xs font-bold tracking-wide transition ' + (currency === c ? 'bg-green-500 text-white shadow' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50')}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
