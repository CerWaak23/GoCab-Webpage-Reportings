import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSesionConductor } from '@/lib/sesion-conductor';
import FotosAuto from '@/components/portal/FotosAuto';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fotos de tu auto · GoCab' };

export default async function FotosConductor() {
  const sesion = await getSesionConductor();
  if (!sesion) redirect('/conductores');
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-4">
        <img src="/gocab-full.svg" alt="GoCab" className="h-8 w-auto" />
        <Link href="/conductores/inicio" className="text-base font-semibold text-gray-500">Inicio</Link>
      </div>
      <div className="mx-auto max-w-md px-4 py-6">
        <FotosAuto />
      </div>
    </main>
  );
}
