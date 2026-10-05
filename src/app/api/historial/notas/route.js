export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';
import { puedeHacerActas } from '@/lib/historial/permisos';
import { textoNotaValido } from '@/lib/historial/configuracion';
import { supabaseServidor } from '@/lib/supabase/server';

/**
 * Nota fechada y con autor sobre un evento (R13, AE5). Es la única forma de
 * corregir un acta firmada: el acta original queda intacta.
 */
export async function POST(request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });
  if (!puedeHacerActas(session.user)) return NextResponse.json({ error: 'sin_permiso' }, { status: 403 });
  const { eventoId, texto } = await request.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/.test(eventoId || '') || !textoNotaValido(texto)) return NextResponse.json({ error: 'datos' }, { status: 400 });
  const { data, error } = await supabaseServidor().from('notas')
    .insert({ evento_id: eventoId, autor_email: session.user.email, texto: String(texto).trim() })
    .select('id, texto, autor_email, creado').single();
  if (error) return NextResponse.json({ error: 'base' }, { status: 500 });
  return NextResponse.json(data);
}
