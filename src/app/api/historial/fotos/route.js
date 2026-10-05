export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeVerSeccion } from '@/lib/i18n/secciones';
import { normalizarPatente } from '@/lib/patente';
import { supabaseServidor } from '@/lib/supabase/server';

/** Fotos del auto con URL firmada de 5 minutos, para las miniaturas de la ficha. */
export async function GET(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeVerSeccion(session.user.role, 'historial')) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const patente = normalizarPatente(new URL(request.url).searchParams.get('patente'));
  if (!patente) return NextResponse.json({ error: 'patente' }, { status: 400 });

  const sb = supabaseServidor();
  const { data, error } = await sb.from('archivos')
    .select('id, toma, ruta, tomada_en, recibida_en, eventos(tipo, fecha)')
    .eq('patente', patente).eq('clase', 'foto').order('recibida_en', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
  if (data.length === 0) return NextResponse.json({ fotos: [] });

  const { data: urls, error: e2 } = await sb.storage.from('fotos').createSignedUrls(data.map((a) => a.ruta), 300);
  if (e2) return NextResponse.json({ error: 'storage' }, { status: 500 });
  const urlDe = new Map(urls.map((u) => [u.path, u.signedUrl]));
  return NextResponse.json({
    fotos: data.map((a) => ({
      id: a.id, toma: a.toma, url: urlDe.get(a.ruta) || null,
      tomadaEn: a.tomada_en || a.recibida_en, evento: a.eventos?.tipo || null,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
