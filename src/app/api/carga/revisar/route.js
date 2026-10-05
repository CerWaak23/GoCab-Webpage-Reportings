export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga } from '@/lib/carga/permisos';
import { hoyEnChile } from '@/lib/carga/payload';
import { analizarExport } from '@/lib/fleet';
import { supabaseServidor } from '@/lib/supabase/server';
import { leerArchivo, estadoBase } from '@/lib/carga/servidor';

/**
 * Lee un export ya subido, lo reconoce y calcula qué cambiaría. No escribe
 * en autos ni conductores: solo registra la carga como pendiente de aplicar.
 */
export async function POST(request) {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'revisar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });

  const { ruta, nombre } = await request.json().catch(() => ({}));
  if (!ruta || !/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(xlsx|xls|csv)$/.test(ruta)) {
    return NextResponse.json({ error: 'ruta' }, { status: 400 });
  }

  try {
    const filas = await leerArchivo(ruta);
    const analisis = analizarExport(filas, await estadoBase(), hoyEnChile());
    if (!analisis.tipo) return NextResponse.json({ nombre, error: analisis.error });

    const { data, error } = await supabaseServidor().from('cargas').insert({
      tipo: analisis.tipo,
      archivo: String(nombre || 'archivo').slice(0, 200),
      ruta_storage: ruta,
      filas: filas.length,
      resumen: analisis.resumen,
      diferencias: analisis.diferencias ?? [],
      usuario_email: session.user.email,
    }).select('id').single();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      id: data.id, nombre, tipo: analisis.tipo, filas: filas.length,
      resumen: analisis.resumen, diferencias: analisis.diferencias ?? [],
    });
  } catch (err) {
    console.error('carga/revisar', err.message);
    return NextResponse.json({ error: 'lectura' }, { status: 500 });
  }
}
