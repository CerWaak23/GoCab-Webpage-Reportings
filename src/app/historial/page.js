import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import SeccionNueva from '@/components/SeccionNueva';

export const dynamic = 'force-dynamic';

export default async function Historial() {
  const session = await getAppSession();
  if (!session) redirect('/');
  return <SeccionNueva tituloClave="historial_title" color="emerald" />;
}
