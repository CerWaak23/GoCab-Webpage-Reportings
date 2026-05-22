import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAppSession } from '@/lib/session';
import LogoutButton from '@/components/LogoutButton';
import LangSwitcher from '@/components/LangSwitcher';
import CurrencySwitcher from '@/components/CurrencySwitcher';

export default async function FinancialReport() {
  const session = await getAppSession();
  if (!session) redirect('/');
  // Accessible to all authenticated users

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      <header className="border-b border-gray-800/60 bg-gray-950/80 backdrop-blur sticky top-0 z-10 shrink-0">
        <div className="px-6 py-3 flex items-center justify-between gap-3">
          {/* Left: breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/dashboard"
              className="flex items-center gap-1.5 text-gray-500 hover:text-white transition text-xs shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Dashboard
            </Link>
            <span className="text-gray-700">/</span>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded bg-green-500/20 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-sm font-semibold truncate">Dashboard Financiero</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 font-medium shrink-0">
                Gerentes
              </span>
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2 shrink-0">
            <LangSwitcher iframeSelector="iframe" />
            <CurrencySwitcher iframeSelector="iframe" />
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="flex-1">
        <iframe
          src="/reports/financial-dashboard.html"
          className="w-full border-0"
          style={{ height: 'calc(100vh - 57px)' }}
          title="Dashboard Financiero GoCab"
        />
      </div>
    </div>
  );
}
