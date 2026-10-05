export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerArchivo, registraAcceso } from '@/lib/historial/permisos';
import { supabaseServidor } from '@/lib/supabase/server';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * URL firmada de 5 minutos para ver o descargar un archivo. Las cédulas,
 * firmas, actas y documentos de siniestro dejan registro de quién los abrió
 * (R63); si el registro falla, no se entrega el archivo.
 */
export async function GET(request) {
  const session = await getAppSession();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const accion = searchParams.get('descargar') ? 'descargar' : 'ver';
  if (!UUID.test(id || '')) return NextResponse.json({ error: 'id' }, { status: 400 });

  const sb = supabaseServidor();
  const { data: archivo, error } = await sb.from('archivos').select('id, clase, bucket, ruta').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
  if (!archivo) return NextResponse.json({ error: 'no_existe' }, { status: 404 });

  const negado = puedeVerArchivo(session?.user, archivo.clase);
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });

  if (registraAcceso(archivo.clase)) {
    const { error: e } = await sb.from('registro_accesos').insert({ usuario_email: session.user.email, archivo_id: archivo.id, accion });
    if (e) {
      console.error('historial/archivo registro', e.message);
      return NextResponse.json({ error: 'registro' }, { status: 500 });
    }
  }

  const { data, error: e2 } = await sb.storage.from(archivo.bucket)
    .createSignedUrl(archivo.ruta, 300, accion === 'descargar' ? { download: true } : undefined);
  if (e2) return NextResponse.json({ error: 'storage' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } });
}
