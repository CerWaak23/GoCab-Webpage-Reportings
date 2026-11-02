import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import SeccionNueva from '@/components/SeccionNueva';
import CargaDatos from '@/components/carga/CargaDatos';
import Maestra from '@/components/carga/Maestra';
import PestanasCarga from '@/components/carga/PestanasCarga';
import Peajes from '@/components/carga/Peajes';

export const dynamic = 'force-dynamic';

export default async function Carga({ searchParams }) {
  const session = await getAppSession();
  if (!session) redirect('/');
  if (!puedeVerSeccion(session.user.role, 'carga')) redirect('/dashboard');
  const vista = ['maestra', 'peajes'].includes(searchParams?.vista) ? searchParams.vista : 'archivos';
  return (
    <SeccionNueva tituloClave="carga_title" color="sky">
      <PestanasCarga vista={vista} />
      {vista === 'maestra' ? <Maestra /> : vista === 'peajes' ? <Peajes /> : <CargaDatos />}
    </SeccionNueva>
  );
}
