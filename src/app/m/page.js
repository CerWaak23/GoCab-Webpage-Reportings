import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeHacerActas } from '@/lib/historial/permisos';
import MovilMarco from '@/components/historial/MovilMarco';
import MovilInicio from '@/components/historial/MovilInicio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Celular · GoBills' };

export default async function Movil() {
  const session = await getAppSession();
  if (!session) redirect('/');
  if (!puedeHacerActas(session.user)) redirect('/historial');
  return <MovilMarco><MovilInicio /></MovilMarco>;
}
