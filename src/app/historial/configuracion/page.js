import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import SeccionNueva from '@/components/SeccionNueva';
import Configuracion from '@/components/historial/Configuracion';

export const dynamic = 'force-dynamic';

export default async function PaginaConfiguracion() {
  const session = await getAppSession();
  if (!session) redirect('/');
  return (
    <SeccionNueva tituloClave="cf_titulo" color="emerald">
      <Configuracion />
    </SeccionNueva>
  );
}
