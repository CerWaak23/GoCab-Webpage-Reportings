export const dynamic = 'force-dynamic'; // la sesión no se cachea

import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/session';

const noCache = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };

/**
 * GET /api/me → { user: { name, email, role, isManager } } o { user: null }
 *
 * Los reportes son HTML estático y la cookie de sesión es httpOnly, así que su
 * JavaScript no puede leerla. Este endpoint es la única forma que tienen de saber
 * quién está conectado — se usa para firmar quién marcó cada paso de un protocolo.
 */
export async function GET() {
  try {
    const session = await getAppSession();
    if (!session) return NextResponse.json({ user: null }, { headers: noCache });
    const { name, email, role, isManager } = session.user;
    return NextResponse.json({ user: { name, email, role, isManager } }, { headers: noCache });
  } catch {
    return NextResponse.json({ user: null }, { headers: noCache });
  }
}
