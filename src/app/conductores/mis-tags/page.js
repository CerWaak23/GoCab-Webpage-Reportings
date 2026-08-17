import { redirect } from 'next/navigation';
import MisTags from '@/components/MisTags';
import { getSesionConductor } from '@/lib/sesion-conductor';

export const metadata = {
  title: 'Mis TAG · GoCab',
};

export default async function MisTagsPage() {
  // El middleware ya filtró, pero un Server Component sin su propia verificación
  // depende de que nadie toque el matcher después.
  const sesion = await getSesionConductor();
  if (!sesion) redirect('/conductores');

  return <MisTags />;
}
