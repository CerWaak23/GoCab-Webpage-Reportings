import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import SeccionNueva from '@/components/SeccionNueva';
import CargaDatos from '@/components/carga/CargaDatos';
import Maestra from '@/components/carga/Maestra';
import PestanasCarga from '@/components/carga/PestanasCarga';

export const dynamic = 'force-dynamic';

export default async function Carga({ searchParams }) {
  const session = await getAppSession();
  if (!session) redirect('/');
  if (!puedeVerSeccion(session.user.role, 'carga')) redirect('/dashboard');
  const vista = searchParams?.vista === 'maestra' ? 'maestra' : 'archivos';
  return (
    <SeccionNueva tituloClave="carga_title" color="sky">
      <PestanasCarga vista={vista} />
      {vista === 'maestra' ? <Maestra /> : <CargaDatos />}
    </SeccionNueva>
  );
}
