export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { permisoCarga, validarArchivo } from '@/lib/carga/permisos';
import { hoyEnChile } from '@/lib/carga/payload';
import { supabaseServidor } from '@/lib/supabase/server';
import { BUCKET } from '@/lib/carga/servidor';

/**
 * Entrega una URL firmada para que el navegador suba el export directo a
 * Storage (las funciones de Vercel no aceptan cuerpos de más de 4,5 MB).
 */
export async function POST(request) {
  const session = await getAppSession();
  const negado = permisoCarga(session?.user, 'revisar');
  if (negado) return NextResponse.json({ error: 'sin_permiso' }, { status: negado });

  const { nombre, tamano } = await request.json().catch(() => ({}));
  const v = validarArchivo(nombre, tamano);
  if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });

  const ruta = `${hoyEnChile()}/${crypto.randomUUID()}.${v.ext}`;
  const { data, error } = await supabaseServidor().storage.from(BUCKET).createSignedUploadUrl(ruta);
  if (error) {
    console.error('carga/subir', error.message);
    return NextResponse.json({ error: 'storage' }, { status: 500 });
  }
  return NextResponse.json({ ruta, token: data.token });
}
