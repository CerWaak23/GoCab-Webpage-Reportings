import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import LogoutButton from '@/components/LogoutButton';
import LangSwitcher from '@/components/LangSwitcher';
import CurrencySwitcher from '@/components/CurrencySwitcher';
import LocalizedDashboard from '@/components/LocalizedDashboard';

export default async function Dashboard() {
  const session = await getAppSession();
  if (!session) redirect('/');

  const { gocabName, role, isManager } = session.user;
  const firstName = gocabName?.split(' ')[0] ?? session.user.name?.split(' ')[0] ?? 'Hola';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800/60 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center shadow shadow-green-500/30">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="font-semibold text-sm">GoCab Reportes</span>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitcher />
            <CurrencySwitcher />
            <LogoutButton />
          </div>
        </div>
      </header>

      <L