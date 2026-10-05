import { redirect } from 'next/navigation';
import ConductorLogin from '@/components/ConductorLogin';
import { getSesionConductor } from '@/lib/sesion-conductor';

export const metadata = {
  title: 'Portal de conductores · GoCab',
  description: 'Tus TAG y las fotos de tu auto',
};

export default async function IngresoConductores() {
  // Si ya entró antes en este teléfono, que no tenga que escribir todo de nuevo.
  const sesion = await getSesionConductor();
  if (sesion) redirect('/conductores/inicio');

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="border-b border-gray-200 bg-white px-4 py-4">
        <img src="/gocab-full.svg" alt="GoCab" className="h-8 w-auto" />
      </div>

      <div className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-3xl font-extrabold text-gray-900">Portal de conductores</h1>
        <p className="mb-8 mt-2 text-lg leading-snug text-gray-600">
          Revisa tus TAG y sube las fotos de tu auto.
        </p>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <ConductorLogin />
        </div>

        <p className="mt-8 text-center text-base leading-relaxed text-gray-500">
          ¿No puedes entrar?<br />
          Habla con tu coordinador de flota.
        </p>
      </div>
    </main>
  );
}
