export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSesionConductor } from '@/lib/sesion-conductor';
import { supabaseServidor } from '@/lib/supabase/server';

/** Mis actas (R14): entregas, recepciones, levantamientos y revisiones del conductor. */
export async function GET() {
  const sesion = await getSesionConductor();
  if (!sesion?.conductorId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { data, error } = await supabaseServidor().from('eventos')
    .select('id, tipo, fecha, patente, pdf_ruta, detalle')
    .eq('conductor_id', sesion.conductorId)
    .in('tipo', ['entrega', 'recepcion', 'levantamiento', 'revision'])
    .order('fecha', { ascending: false });
  if (error) return NextResponse.json({ error: 'interno' }, { status: 500 });
  return NextResponse.json({
    actas: data.map((e) => ({
      id: e.id, tipo: e.tipo, fecha: e.fecha, patente: e.patente, pdf: !!e.pdf_ruta,
      km: e.detalle?.km ?? null, sinFirma: !!e.detalle?.sinFirma,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
