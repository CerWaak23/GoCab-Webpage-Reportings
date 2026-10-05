import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import SeccionNueva from '@/components/SeccionNueva';
import Tiempo from '@/components/historial/Tiempo';

export const dynamic = 'force-dynamic';

export default async function FlotaEnElTiempo() {
  const session = await getAppSession();
  if (!session) redirect('/');
  return (
    <SeccionNueva tituloClave="historial_title" color="emerald" ancho>
      <Tiempo />
    </SeccionNueva>
  );
}
