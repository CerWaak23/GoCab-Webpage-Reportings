export const dynamic = 'force-dynamic';

import { google } from 'googleapis';
import { NextResponse } from 'next/server';

const noCache = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/cloud-translation'],
  });
}

/**
 * POST /api/traducir  { text, target }  →  { text: '…', source: 'es' }
 *
 * Traduce texto escrito por personas (comentarios de gestión, notas de un caso).
 * Los textos de la interfaz NO pasan por acá: esos viven en los diccionarios del
 * reporte, que son traducciones revisadas y no cuestan nada.
 *
 * El resultado se cachea del lado del reporte junto al comentario, así una misma
 * frase se traduce —y se paga— una sola vez.
 */
export async function POST(req) {
  try {
    const { text, target } = await req.json();
    const q = String(text || '').trim();
    const to = String(target || '').trim().toLowerCase();
    if (!q) return NextResponse.json({ error: 'Sin texto que traducir' }, { status: 400, headers: noCache });
    if (!['es', 'en', 'ru'].includes(to)) {
      return NextResponse.json({ error: 'Idioma no soportado' }, { status: 400, headers: noCache });
    }
    if (q.length > 5000) {
      return NextResponse.json({ error: 'Texto demasiado largo' }, { status: 400, headers: noCache });
    }

    const translate = google.translate({ version: 'v2', auth: getAuth() });
    const res = await translate.translations.translate({
      requestBody: { q: [q], target: to, format: 'text' },
    });
    const item = res.data?.data?.translations?.[0];
    if (!item) throw new Error('Respuesta vacía del traductor');

    return NextResponse.json(
      { text: item.translatedText, source: item.detectedSourceLanguage || null },
      { headers: noCache }
    );
  } catch (err) {
    const msg = String(err?.message || err);
    // El caso más probable la primera vez: la API existe pero no está habilitada
    // en el proyecto de Google Cloud. Se distingue para no mandar a nadie a
    // depurar credenciales cuando lo que falta es un botón en la consola.
    const apagada = /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured|billing/i.test(msg);
    return NextResponse.json(
      { error: msg, necesitaHabilitar: apagada },
      { status: 500, headers: noCache }
    );
  }
}
