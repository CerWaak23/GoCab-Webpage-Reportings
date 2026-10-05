export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga } from '@/lib/carga/permisos';
import { supabaseServidor } from '@/lib/supabase/server';

/** Última carga aplicada por tipo, historial y diferencias de la última carga de autos. */
export async function GET() {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'revisar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });

  const { data, error } = await supabaseServidor().from('cargas')
    .select('id, tipo, archivo, filas, usuario_email, creado, diferencias')
    .eq('aplicada', true).order('creado', { ascending: false }).limit(40);
  if (error) return NextResponse.json({ error: 'base' }, { status: 500 });

  const ultimas = {};
  for (const c of data) if (!ultimas[c.tipo]) ultimas[c.tipo] = { archivo: c.archivo, filas: c.filas, por: c.usuario_email, en: c.creado };
  const vehiculos = data.find((c) => c.tipo === 'vehicles');
  return NextResponse.json({
    ultimas,
    historial: data.slice(0, 20).map(({ diferencias, ...c }) => c),
    diferencias: vehiculos?.diferencias ?? [],
    puedeAplicar: !permisoCarga(session.user, 'aplicar'),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
