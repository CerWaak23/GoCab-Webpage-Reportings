import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import SeccionNueva from '@/components/SeccionNueva';
import Despedidos from '@/components/despedidos/Despedidos';

export const dynamic = 'force-dynamic';

export default async function PaginaDespedidos() {
  const session = await getAppSession();
  if (!session) redirect('/');
  if (!puedeVerSeccion(session.user.role, 'despedidos')) redirect('/dashboard');
  return (
    <SeccionNueva tituloClave="dp_title" color="sky" ancho>
      <Despedidos />
    </SeccionNueva>
  );
}
