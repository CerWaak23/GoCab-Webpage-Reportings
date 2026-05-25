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

// Parse "$285,79" → 285.79
function parseValor(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim());
  return isNaN(n) ? 0 : n;
}

// Parse "27-02-2026 18:25" (DD-MM-YYYY HH:MM) → Date
function parseFecha(s) {
  if (!s) return null;
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
  return `W${weekStart.getDate()}/${mn[weekStart.getMonth()]}`;
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
    const _debug = []; // temporary: header info per file

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
      _debug.push({
        file: file.name,
        headerIdx,
        header: header.slice(0, 20),
        row0: (rows[0] || []).slice(0, 10).map(String),
        row14: (rows[14] || []).slice(0, 10).map(String),
        totalRows: rows.length,
      });

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

        if (!byPatente[plate]) byPatente[plate] = { _rawPlate: rawPlate };
        byPatente[plate][wk] = (byPatente[plate][wk] || 0) + valor;

        if (!weekDates[wk]) weekDates[wk] = fecha;
        else if (fecha < weekDates[wk]) weekDates[wk] = fecha;
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
      _debug,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
