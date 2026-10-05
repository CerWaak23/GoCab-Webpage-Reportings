import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSesionConductor } from '@/lib/sesion-conductor';
import { estadoFotos } from '@/lib/portal/fotos';
import Salir from '@/components/portal/Salir';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inicio · GoCab' };

/** Inicio del portal de conductores: fotos del auto y Mis TAG. */
export default async function InicioConductor() {
  const sesion = await getSesionConductor();
  if (!sesion) redirect('/conductores');

  // Con sesión de la planilla antigua (sin ficha en la base) solo hay TAG.
  const fotos = sesion.conductorId ? await estadoFotos(sesion).catch(() => null) : null;
  const tarjeta = 'block rounded-2xl bg-white p-6 shadow-sm transition active:scale-[0.99]';

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-4">
        <img src="/gocab-full.svg" alt="GoCab" className="h-8 w-auto" />
        <Salir />
      </div>
      <div className="mx-auto max-w-md space-y-4 px-4 py-8">
        <h1 className="text-3xl font-extrabold text-gray-900">Hola, {sesion.nombre}</h1>
        <p className="text-lg text-gray-600">Auto <b className="tracking-wider">{sesion.patente}</b></p>

        {fotos?.puede && (
          <Link href="/conductores/fotos" className={`${tarjeta} border-2 border-amber-300`}>
            <p className="text-sm font-bold uppercase tracking-wide text-amber-600">Pendiente</p>
            <p className="mt-1 text-xl font-extrabold text-gray-900">
              {fotos.tipo === 'levantamiento' ? 'Saca las fotos de tu auto' : 'Revisión mensual de tu auto'}
            </p>
            <p className="mt-1 text-base text-gray-600">5 fotos y el kilometraje. Unos 5 minutos.</p>
          </Link>
        )}
        {fotos && !fotos.puede && fotos.vigente && (
          <div className={tarjeta}>
            <p className="text-xl font-extrabold text-gray-900">Fotos de tu auto al día ✓</p>
            {fotos.vence && <p className="mt-1 text-base text-gray-600">Próxima revisión: {new Date(`${fotos.vence}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}</p>}
          </div>
        )}

        <Link href="/conductores/mis-tags" className={tarjeta}>
          <p className="text-xl font-extrabold text-gray-900">Mis TAG</p>
          <p className="mt-1 text-base text-gray-600">Cuánto has gastado en autopistas y el detalle de cada pasada.</p>
        </Link>

        <p className="pt-4 text-center text-base text-gray-500">¿Algún problema? Habla con tu coordinador de flota.</p>
      </div>
    </main>
  );
}
