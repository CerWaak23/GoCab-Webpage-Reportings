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
    let iCoord = header.findIndex(
      (h) => h.includes('coordinator') || h.includes('coordinador') || h.includes('encargado')
    );
    if (iCoord < 0) {
      // Respaldo por si vuelven a renombrarla: la última columna con datos, pero
      // saltando las que sabemos que son otra cosa. Sin esta exclusión, agregar
      // "Rut" y "Tipo" hacía que el filtro de coordinador mostrara DTO y Renta.
      const esOtraCosa = (h) => /rut|tipo|modalidad|patente|veh|fecha|creat|nota|mail|correo|telefono|fono/.test(h);
      for (let c = header.length - 1; c >= 3; c--) {
        if (esOtraCosa(header[c])) continue;
        const llenas = body.filter((r) => String(r[c] || '').trim()).length;
        if (body.length && llenas / body.length > 0.5) { iCoord = c; break; }
      }
    }
    // Modalidad del vehículo: DTO (drive to own) o renta
    const iTipo = header.findIndex((h) => h === 'tipo' || h.includes('modalidad'));

    const drivers = body.map((r) => ({
      conductor: String(r[0] || '').trim().toUpperCase(),
      patente: String(r[1] || '').trim(),
      fechaInicio: String(r[2] || '').trim(),
      nota: String(r[3] || '').trim(),
      coordinador: iCoord >= 0 ? String(r[iCoord] || '').trim() : '',
      tipo: iTipo >= 0 ? String(r[iTipo] || '').trim() : '',
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
      // Por nombre de columna y no por posición: esta hoja ya gano una columna
      // (MODELO-MARCA en la C) y leerla por indice fijo corrio todos los campos
      // una casilla, haciendo que la fecha de ingreso se leyera como egreso.
      const th = (tRows[0] || []).map((h) =>
        String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
      );
      const tcol = (...claves) => {
        for (const k of claves) {
          const i = th.findIndex((h) => h.includes(k));
          if (i !== -1) return i;
        }
        return -1;
      };
      const cPat = tcol('patente', 'plate');
      const cEst = tcol('estado');
      const cMod = tcol('modelo', 'marca');
      const cIng = tcol('ingreso');
      const cEgr = tcol('egreso', 'salida');
      const cTal = tcol('taller');
      const cObs = tcol('observ');
      const cCon = tcol('conductor');
      const val = (r, i) => (i >= 0 ? String(r[i] || '').trim() : '');

      taller = tRows.slice(1)
        .filter((r) => val(r, cPat))
        .map((r) => ({
          patente: val(r, cPat).toUpperCase().replace(/[-\s]/g, ''),
          estado: val(r, cEst),
          modelo: val(r, cMod),
          ingreso: val(r, cIng),
          // "SIN FECHA" es el marcador que usa la planilla cuando el taller
          // todavía no compromete una salida: se normaliza a vacío para que el
          // reporte no tenga que conocer esa convención.
          egreso: /sin\s*fecha/i.test(val(r, cEgr)) ? '' : val(r, cEgr),
          taller: val(r, cTal),
          observaciones: val(r, cObs),
          ultimoConductor: val(r, cCon),
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
