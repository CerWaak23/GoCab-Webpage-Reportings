'use client';
import { useState, useEffect } from 'react';
import { traducir } from './dict';

/** Idioma elegido en el selector de GoBills, con su función de traducción. */
export function useLang() {
  const [lang, setLang] = useState('es');

  useEffect(() => {
    try { setLang(localStorage.getItem('gocab_lang') || 'es'); } catch (_) {}
    const handler = (e) => setLang(e.detail);
    window.addEventListener('gocab_lang_change', handler);
    return () => window.removeEventListener('gocab_lang_change', handler);
  }, []);

  return { lang, t: (clave) => traducir(lang, clave) };
}
