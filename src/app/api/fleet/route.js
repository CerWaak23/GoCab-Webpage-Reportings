export const dynamic = 'force-dynamic'; // never cache — always fetch latest from Sheets

import { google } from 'googleapis';
import { NextResponse } from 'next/server';

const FLEET_SHEET_ID = '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw';
const FLEET_SHEET_NAME = 'Vehiculos y ConductoresII';
const TALLER_SHEET_NAME = 'VEHÍCULOS EN TALLER';

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

    // Las tres primeras columnas (Name, Vehicles, Created At) son estables; la del
    // coordinador se ha movido de sitio y ha perdido su encabezado, así que se busca
    // en vez de leerse por posición fija: primero por nombre de encabezado y, si no
    // aparece, la última columna que venga llena en la mayoría de las filas.
    const header = (rows[0] || []).map((h) => String(h || '').toLowerCase().trim());
    const body = rows.slice(1).filter((r) => r[0]);
    let iCoord = header.findIndex((h) => h.includes('coordinator') || h.includes('coordinador'));
    if (iCoord < 0) {
      for (let c = header.length - 1; c >= 3; c--) {
        const llenas = body.filter((r) => String(r[c] || '').trim()).length;
        if (body.length && llenas / body.length > 0.5) { iCoord = c; break; }
      }
    }

    const drivers = body.map((r) => ({
      conductor: String(r[0] || '').trim().toUpperCase(),
      patente: String(r[1] || '').trim(),
      fechaInicio: String(r[2] || '').trim(),
      nota: String(r[3] || '').trim(),
      coordinador: iCoord >= 0 ? String(r[iCoord] || '').trim() : '',
    }));

    // ── Vehículos en taller ───────────────────────────────────────────────────
    // Hoja aparte de la misma planilla. Si falla o no existe, el resto del
    // endpoint sigue sirviendo: la flota no depende de esto.
    let taller = [];
    try {
      const tRes = await sheets.spreadsheets.values.get({
        spreadsheetId: FLEET_SHEET_ID,
        range: TALLER_SHEET_NAME,
        quotaUser: `gc-${Date.now()}`,
      });
      const tRows = tRes.data.values || [];
      taller = tRows.slice(1)
        .filter((r) => String(r[0] || '').trim())
        .map((r) => ({
          patente: String(r[0] || '').trim().toUpperCase().replace(/[-\s]/g, ''),
          estado: String(r[1] || '').trim(),
          ingreso: String(r[2] || '').trim(),
          // "SIN FECHA" es el marcador que usa la planilla cuando el taller
          // todavía no compromete una salida: se normaliza a vacío para que el
          // reporte no tenga que conocer esa convención.
          egreso: /sin\s*fecha/i.test(String(r[3] || '')) ? '' : String(r[3] || '').trim(),
          taller: String(r[4] || '').trim(),
          observaciones: String(r[5] || '').trim(),
          ultimoConductor: String(r[6] || '').trim(),
        }));
    } catch (e) {
      taller = [];
    }

    const noCache = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };
    return NextResponse.json({ drivers, taller, _fetchedAt: new Date().toISOString() }, { headers: noCache });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
