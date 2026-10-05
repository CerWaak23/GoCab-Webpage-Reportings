import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/session';
import { puedeHacerActas } from '@/lib/historial/permisos';
import { normalizarPatente } from '@/lib/patente';
import { TIPOS_ACTA } from '@/lib/historial/actas';
import MovilMarco from '@/components/historial/MovilMarco';
import Protocolo from '@/components/historial/Protocolo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Acta · GoBills' };

export default async function PaginaProtocolo({ searchParams }) {
  const session = await getAppSession();
  if (!session) redirect('/');
  if (!puedeHacerActas(session.user)) redirect('/historial');
  const tipo = searchParams?.tipo;
  const patente = normalizarPatente(searchParams?.patente);
  if (!TIPOS_ACTA.includes(tipo) || !patente) redirect('/m');
  return <MovilMarco volver="/m"><Protocolo tipo={tipo} patente={patente} /></MovilMarco>;
}
