export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga } from '@/lib/carga/permisos';
import { hoyEnChile } from '@/lib/carga/payload';
import { avisosCarga, numeroExport } from '@/lib/carga/avisos';
import { analizarExport } from '@/lib/fleet';
import { revisarCalidad } from '@/lib/fleet/calidad';
import { supabaseServidor } from '@/lib/supabase/server';
import { leerArchivo, estadoBase, cargasPrevias } from '@/lib/carga/servidor';

/**
 * Lee un export ya subido, lo reconoce, revisa su calidad y calcula qué
 * cambiaría. No escribe en autos ni conductores: solo registra la carga como
 * pendiente de aplicar, con sus avisos.
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
    const { filas, sha256 } = await leerArchivo(ruta);
    const base = await estadoBase();
    const analisis = analizarExport(filas, base, hoyEnChile());
    if (!analisis.tipo) return NextResponse.json({ nombre, error: analisis.error });

    const calidad = revisarCalidad(analisis.tipo, filas, {
      conductores: base.conductores,
      patentes: base.autos.map((a) => a.patente),
    });
    const numero = numeroExport(nombre);
    const avisos = avisosCarga(
      { tipo: analisis.tipo, filas: filas.length, numero, sha256, graves: calidad.graves },
      await cargasPrevias(analisis.tipo),
    );
    const resumen = { ...analisis.resumen, calidad };

    const { data, error } = await supabaseServidor().from('cargas').insert({
      tipo: analisis.tipo,
      archivo: String(nombre || 'archivo').slice(0, 200),
      ruta_storage: ruta,
      filas: filas.length,
      resumen,
      diferencias: analisis.diferencias ?? [],
      usuario_email: session.user.email,
      sha256,
      numero_export: numero,
      avisos,
    }).select('id').single();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      id: data.id, nombre, tipo: analisis.tipo, filas: filas.length,
      resumen, avisos, diferencias: analisis.diferencias ?? [],
    });
  } catch (err) {
    console.error('carga/revisar', err.message);
    return NextResponse.json({ error: 'lectura' }, { status: 500 });
  }
}
