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
// Handles: JS number (285.79), "$285,79" string, "28579" string
function parseValor(val) {
  if (val === null || val === undefined || val === '') return 0;
  // XLSX often returns numbers directly — use as-is
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  // Remove $ symbol; only remove dots that look like thousand separators
  // (dot followed by exactly 3 digits); replace comma decimal with period
  const cleaned = s
    .replace(/\$/g, '')
    .replace(/\.(?=\d{3}(?:[,\s]|$))/g, '')  // thousand-sep dots
    .replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Parse date from XLSX cell → Date
// Handles: Excel serial number (46080.768…), "27-02-2026 18:25" string, JS Date
function parseFecha(s) {
  if (!s) return null;
  // Already a JS Date (e.g. if XLSX was read with cellDates:true)
  if (s instanceof Date) return isNaN(s) ? null : s;
  // Numeric Excel serial date (e.g. 46080.768)
  const num = typeof s === 'number' ? s : parseFloat(String(s));
  if (!isNaN(num) && num > 40000 && num < 60000) {
    // Excel epoch offset: serial 25569 = 1970-01-01 UTC
    return new Date((num - 25569) * 86400 * 1000);
  }
  const str = String(s).trim();
  // DD-MM-YYYY HH:MM or DD-MM-YYYY
  const m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
}

// Same week-key logic as fleet-debt-report.html (Monday-based, e.g. "W22/Mar")
function getWeekKey(d) {
  if (!d || isNaN(d)) return null;
  const epoch = new Date('2020-01-06'); // known Monday
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const wn = Math.floor((d - epoch) / msPerWeek);
  const weekStart = new Date(epoch.getTime() + wn * msPerWeek);
  const mn = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${weekStart.getUTCDate()} ${mn[weekStart.getUTCMonth()]}`;
}

// Normalize plate for comparison: uppercase, no dashes/spaces
function normPlate(s) {
  return String(s || '').toUpperCase().replace(/[-\s]/g, '').trim();
}

export async function GET() {
  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    const listRes = await drive.files.list({
      q: `'${TOLLS_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime)',
      orderBy: 'modifiedTime asc',
    });

    const files = listRes.data.files || [];

    // byPatente[normPlate] = { [weekKey]: totalCLP, _rawPlate }
    const byPatente = {};
    const weekDates = {}; // weekKey → Date (for sorting)

    for (const file of files) {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.csv')) continue;

      const fileRes = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
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

      // Find header row: contains "Patente" or "Móvil"
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const joined = rows[i].map(c => String(c).toLowerCase()).join('|');
        if (joined.includes('patente') || joined.includes('móvil')) {
          headerIdx = i;
          break;
        }
      }
      const header = headerIdx === -1 ? [] : rows[headerIdx].map(h => String(h).toLowerCase().trim());

      if (headerIdx === -1) continue;

      const ci = (names) => {
        for (const n of names) {
          const idx = header.findIndex(h => h.includes(n));
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const iPatente = ci(['patente', 'móvil', 'movil', 'placa']);
      const iValor   = ci(['valor', 'monto', 'importe', 'cobro']);
      const iFecha   = ci(['fecha inicial', 'fecha inicio', 'fecha']);

      if (iPatente === -1 || iValor === -1 || iFecha === -1) continue;

      // Per-file accumulator — prevents double-counting when files are cumulative
      // (e.g. "Mayo Recurrente" contains all passages since Jan, not just May)
      const fileAccum = {};
      const fileRawPlate = {};

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const rawPlate = String(row[iPatente] || '').trim();
        if (!rawPlate) continue;

        const plate = normPlate(rawPlate);
        if (!plate) continue;

        const valor = parseValor(row[iValor]);
        if (valor <= 0) continue;

        const fecha = parseFecha(row[iFecha]);
        const wk = fecha ? getWeekKey(fecha) : null;
        if (!wk) continue;

        if (!fileAccum[plate]) { fileAccum[plate] = {}; fileRawPlate[plate] = rawPlate; }
        fileAccum[plate][wk] = (fileAccum[plate][wk] || 0) + valor;

        if (!weekDates[wk]) weekDates[wk] = fecha;
        else if (fecha < weekDates[wk]) weekDates[wk] = fecha;
      }

      // Merge into global byPatente: take the max across files for each plate+week.
      // If files are cumulative, the newest (largest) file wins per period.
      // If files are period-specific, there is no overlap and max == the value.
      for (const [plate, wkMap] of Object.entries(fileAccum)) {
        if (!byPatente[plate]) byPatente[plate] = { _rawPlate: fileRawPlate[plate] };
        for (const [wk, val] of Object.entries(wkMap)) {
          byPatente[plate][wk] = Math.max(byPatente[plate][wk] || 0, val);
        }
      }
    }

    // Sort weeks chronologically
    const allWeeks = Object.keys(weekDates).sort((a, b) => weekDates[a] - weekDates[b]);

    // Compute total per plate
    const totalByPatente = {};
    for (const [plate, data] of Object.entries(byPatente)) {
      totalByPatente[plate] = allWeeks.reduce((s, wk) => s + (data[wk] || 0), 0);
    }

    return NextResponse.json({
      byPatente,
      allWeeks,
      totalByPatente,
      sources: files.map(f => f.name),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
