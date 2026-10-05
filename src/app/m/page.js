import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeHacerActas } from '@/lib/historial/permisos';
import MovilMarco from '@/components/historial/MovilMarco';
import MovilInicio from '@/components/historial/MovilInicio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Registros · GoBills' };

/** Registros: entrega, recepción y taller. El encargado de taller solo ve lo de taller. */
export default async function Movil() {
  const session = await getAppSession();
  if (!session) redirect('/');
  return <MovilMarco><MovilInicio puedeActas={puedeHacerActas(session.user)} puedeConfigurar={!!session.user.isManager} /></MovilMarco>;
}
