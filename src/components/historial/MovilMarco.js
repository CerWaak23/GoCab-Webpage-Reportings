'use client';
import Link from 'next/link';
import LangSwitcher from '@/components/LangSwitcher';
import { useLang } from '@/lib/i18n/useLang';

/** Marco claro para el celular del coordinador: se lee mejor al sol. */
export default function MovilMarco({ children, volver }) {
  const { t } = useLang();
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <Link href={volver || '/dashboard'} className="text-sm font-semibold text-gray-600">← {t(volver ? 'm_title' : 'volver_dashboard')}</Link>
        <div className="rounded-lg bg-gray-900 p-0.5"><LangSwitcher /></div>
      </header>
      <main className="mx-auto max-w-md px-4 py-5">{children}</main>
    </div>
  );
}
