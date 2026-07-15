import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAppSession } from '@/lib/session';
import LogoutButton from '@/components/LogoutButton';
import LangSwitcher from '@/components/LangSwitcher';

export default async function TareasReport() {
  const session = await getAppSession();
  if (!session) redirect('/');

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
              <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <span className="text-sm font-semibold truncate">Tareas Operacionales</span>
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2 shrink-0">
            <LangSwitcher iframeSelector="iframe" />
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="flex-1">
        <iframe
          src="/reports/gocab-tareas-actual.html"
          className="w-full border-0"
          style={{ height: 'calc(100vh - 57px)' }}
          title="Tareas Operacionales GoCab"
        />
      </div>
    </div>
  );
}
