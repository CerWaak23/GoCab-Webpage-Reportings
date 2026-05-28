export const dynamic = 'force-dynamic'; // never cache — always fetch latest from Drive

import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

const TOLLS_FOLDER_ID = '1rn3x_-ixgPqwvUzx6Tkqb0Pzjd6LT-xw';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

// Parse value from XLSX cell → CLP number
function parseValor(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  const cleaned = s
    .replace(/\$/g, '')
    .replace(/\.(?=\d{3}(?:[,\s]|$))/g, '')  // thousand-sep dots
    .replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Parse date from XLSX cell → Date
function parseFecha(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  const num = typeof s === 'number' ? s : parseFloat(String(s));
  if (!isNaN(num) && num > 40000 && num < 60000) {
    return new Date((num - 25569) * 86400 * 1000);
  }
  const str = String(s).trim();
  // DD-MM-YYYY or DD/MM/YYYY, optional HH:MM or HH:MM:SS
  const m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
}

function getWeekKey(d) {
  if (!d || isNaN(d)) return null;
  const epoch = new Date('2020-01-06'); // known Monday
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const wn = Math.floor((d - epoch) / msPerWeek);
  const weekStart = new Date(epoch.getTime() + wn * msPerWeek);
  const mn = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${weekStart.getUTCDate()} ${mn[weekStart.getUTCMonth()]}`;
}

function normPlate(s) {
  return String(s || '').toUpperCase().replace(/[-\s]/g, '').trim();
}

// Wraps a promise with a hard wall-clock timeout; resolves (not rejects) with
// `fallback` when the timer fires, so callers always get a value.
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[tolls] Hard timeout after ${ms} ms`);
      resolve(fallback);
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

async function fetchTolls() {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    const listRes = await drive.files.list({
      q: `'${TOLLS_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime)',
      orderBy: 'modifiedTime asc',
    });

    const files = listRes.data.files || [];

    const byPatente = {};
    const weekDates = {};
    const txnSet = new Set();   // dedup key → skip duplicate rows across cumulative files
    const transactions = [];    // individual toll transactions for drill-down
    const fileHeaders = [];     // debug: column headers found in each file
    const startTime = Date.now();

    for (const file of files) {
      // Stop processing if we've already spent 20 s — return whatever we have
      if (Date.now() - startTime > 20000) {
        console.warn('[tolls] 20 s budget reached; returning partial data');
        break;
      }
      const name = file.name.toLowerCase();
      if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.csv')) continue;

      let fileRes;
      try {
        fileRes = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
      } catch (fileErr) {
        console.warn(`[tolls] Skipping ${file.name}: ${fileErr.message}`);
        continue;
      }
      const buffer = Buffer.from(fileRes.data);

      let rows;
      if (name.endsWith('.csv')) {
        const text = buffer.toString('utf-8');
        const lines = text.split(/\r?\n/);
        const delim = lines[0]?.includes(';') ? ';' : ',';
        rows = lines.map(l => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim()));
      } else {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      }

      // Find header row
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const joined = rows[i].map(c => String(c).toLowerCase()).join('|');
        if (joined.includes('patente') || joined.includes('movil') || joined.includes('móvil')) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) continue;

      const header = rows[headerIdx].map(h => String(h).toLowerCase().trim());

      const ci = (names) => {
        for (const n of names) {
          const idx = header.findIndex(h => h.includes(n));
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const iPatente   = ci(['patente', 'móvil', 'movil', 'placa']);
      const iValor     = ci(['valor', 'monto', 'importe', 'cobro']);
      const iFecha     = ci(['fecha inicial', 'fecha inicio', 'fecha']);
      const iAutopista = ci(['autopista', 'ruta', 'vía', 'via']);
      const iPortico   = ci(['pórtico', 'portico', 'portal', 'plaza de cobro', 'plaza', 'peaje', 'estación', 'estacion', 'punto de cobro', 'punto', 'acceso', 'nombre de p', 'nombre p', 'cabina']);
      const iTipoTarifa= ci(['tipo tarifa', 'tipo de tarifa', 'tarifa', 'categoría', 'categoria', 'clase', 'tipo de veh']);

      // Record headers for debugging (helps identify pórtico column name)
      fileHeaders.push({ file: file.name, headers: header, iPatente, iValor, iFecha, iAutopista, iPortico, iTipoTarifa });

      if (iPatente === -1 || iValor === -1 || iFecha === -1) continue;

      const fileAccum = {};
      const fileRawPlate = {};

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const rawPlate = String(row[iPatente] || '').trim();
        if (!rawPlate) continue;

        const plate = normPlate(rawPlate);
        if (!plate) continue;

        const rawValor = row[iValor];
        // Chilean toll files store values as integer centavos (e.g. 71904 = $719.04 CLP).
        // Detect by checking if it's a whole integer and divide by 100.
        // Float values (e.g. 719.04) mean the file already uses pesos — leave them alone.
        const valor = typeof rawValor === 'number' && Number.isInteger(rawValor) && rawValor > 0
          ? rawValor / 100
          : parseValor(rawValor);
        if (valor <= 0) continue;

        const fecha = parseFecha(row[iFecha]);
        const wk = fecha ? getWeekKey(fecha) : null;
        if (!wk) continue;

        if (!fileAccum[plate]) { fileAccum[plate] = {}; fileRawPlate[plate] = rawPlate; }
        fileAccum[plate][wk] = (fileAccum[plate][wk] || 0) + valor;

        if (!weekDates[wk]) weekDates[wk] = fecha;
        else if (fecha < weekDates[wk]) weekDates[wk] = fecha;

        // Individual transaction — deduplicate across cumulative files.
        // Use normalized fechaStr (YYYY-MM-DD) so the same date serialized
        // differently across file exports still maps to the same key.
        const autopista  = iAutopista  >= 0 ? String(row[iAutopista]  || '').trim() : '';
        const portico    = iPortico    >= 0 ? String(row[iPortico]    || '').trim() : '';
        const tipoTarifa = iTipoTarifa >= 0 ? String(row[iTipoTarifa] || '').trim() : '';
        const fechaKey = fecha
          ? `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth()+1).padStart(2,'0')}-${String(fecha.getUTCDate()).padStart(2,'0')}`
          : String(row[iFecha]);
        const txnKey = `${plate}|${fechaKey}|${autopista}|${valor}`;

        if (!txnSet.has(txnKey)) {
          txnSet.add(txnKey);
          const fechaStr = fecha
            ? `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth()+1).padStart(2,'0')}-${String(fecha.getUTCDate()).padStart(2,'0')}`
            : null;
          transactions.push({ plate, rawPlate, wk, fechaStr, autopista, portico, tipoTarifa, valor });
        }
      }

      // Merge into global byPatente: take max across files (handles cumulative exports)
      for (const [plate, wkMap] of Object.entries(fileAccum)) {
        if (!byPatente[plate]) byPatente[plate] = { _rawPlate: fileRawPlate[plate] };
        for (const [wk, val] of Object.entries(wkMap)) {
          byPatente[plate][wk] = Math.max(byPatente[plate][wk] || 0, val);
        }
      }
    }

    const allWeeks = Object.keys(weekDates).sort((a, b) => weekDates[a] - weekDates[b]);

    const totalByPatente = {};
    for (const [plate, data] of Object.entries(byPatente)) {
      totalByPatente[plate] = allWeeks.reduce((s, wk) => s + (data[wk] || 0), 0);
    }

    return { byPatente, allWeeks, totalByPatente, transactions, fileHeaders, sources: files.map(f => f.name) };
}

const EMPTY_TOLLS = { byPatente: {}, allWeeks: [], totalByPatente: {}, transactions: [], fileHeaders: [], sources: [] };

export async function GET() {
  try {
    const data = await withTimeout(fetchTolls(), 22000, EMPTY_TOLLS);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
