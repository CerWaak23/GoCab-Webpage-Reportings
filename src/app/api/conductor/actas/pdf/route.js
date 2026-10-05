export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSesionConductor } from '@/lib/sesion-conductor';
import { supabaseServidor } from '@/lib/supabase/server';
import { actaEsDelConductor } from '@/lib/historial/configuracion';

/**
 * PDF de un acta propia, con URL firmada de 5 minutos. El acceso queda en el
 * registro (R63) a nombre del conductor.
 */
export async function GET(request) {
  const sesion = await getSesionConductor();
  if (!sesion?.conductorId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!/^[0-9a-f-]{36}$/.test(id || '')) return NextResponse.json({ error: 'id' }, { status: 400 });

  const sb = supabaseServidor();
  const { data: evento } = await sb.from('eventos').select('id, conductor_id, pdf_ruta').eq('id', id).maybeSingle();
  if (!actaEsDelConductor(evento, sesion.conductorId)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  if (!evento.pdf_ruta) return NextResponse.json({ error: 'sin_pdf' }, { status: 404 });

  const { data: archivo } = await sb.from('archivos').select('id').eq('ruta', evento.pdf_ruta).maybeSingle();
  const { error: e1 } = await sb.from('registro_accesos')
    .insert({ usuario_email: `conductor:${sesion.conductorId}`, archivo_id: archivo?.id ?? null, accion: 'descargar' });
  if (e1) return NextResponse.json({ error: 'registro' }, { status: 500 });

  const { data, error } = await sb.storage.from('actas').createSignedUrl(evento.pdf_ruta, 300, { download: true });
  if (error) return NextResponse.json({ error: 'interno' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } });
}
