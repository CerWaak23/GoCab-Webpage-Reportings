import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import SeccionNueva from '@/components/SeccionNueva';

export const dynamic = 'force-dynamic';

export default async function Carga() {
  const session = await getAppSession();
  if (!session) redirect('/');
  if (!puedeVerSeccion(session.user.role, 'carga')) redirect('/dashboard');
  return <SeccionNueva tituloClave="carga_title" color="sky" />;
}
