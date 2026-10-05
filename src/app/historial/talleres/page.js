import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import SeccionNueva from '@/components/SeccionNueva';
import Talleres from '@/components/historial/Talleres';

export const dynamic = 'force-dynamic';

export default async function PaginaTalleres() {
  const session = await getAppSession();
  if (!session) redirect('/');
  if (!puedeVerSeccion(session.user.role, 'talleres')) redirect('/dashboard');
  return (
    <SeccionNueva tituloClave="talleres_title" color="emerald" ancho>
      <Talleres />
    </SeccionNueva>
  );
}
