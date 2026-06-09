export const dynamic = 'force-dynamic'; // never cache — always fetch latest from Sheets

import { google } from 'googleapis';
import { NextResponse } from 'next/server';

const FLEET_SHEET_ID = '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw';
const FLEET_SHEET_NAME = 'Vehiculos y ConductoresII';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

export async function GET(request) {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // quotaUser nonce forces Google Sheets API to bypass its server-side response cache
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: FLEET_SHEET_ID,
      range: FLEET_SHEET_NAME,
      quotaUser: `gc-${Date.now()}`,
    });

    const rows = res.data.values || [];
    if (rows.length < 2) return NextResponse.json({ drivers: [] });

    // Row 0 is header: CONDUCTOR, PATENTE, FECHA DE INICIO, ...
    const drivers = rows.slice(1)
      .filter(r => r[0])
      .map(r => ({
        conductor: String(r[0] || '').trim().toUpperCase(),
        patente: String(r[1] || '').trim(),
        fechaInicio: String(r[2] || '').trim(),
        nota: String(r[3] || '').trim(),
      }));

    const noCache = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };
    return NextResponse.json({ drivers, _fetchedAt: new Date().toISOString() }, { headers: noCache });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
