import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import SeccionNueva from '@/components/SeccionNueva';
import Vacaciones from '@/components/vacaciones/Vacaciones';

export const dynamic = 'force-dynamic';

export default async function PaginaVacaciones() {
  const session = await getAppSession();
  if (!session) redirect('/');
  if (!puedeVerSeccion(session.user.role, 'vacaciones')) redirect('/dashboard');
  return (
    <SeccionNueva tituloClave="vc_title" color="sky" ancho>
      <Vacaciones />
    </SeccionNueva>
  );
}
