import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

const SUMUP_FOLDER_ID = '1IR7ETMtvoi-LF4AXbfalbO2th_b_ImNi';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function parseAmt(val) {
  if (!val && val !== 0) return 0;
  const str = String(val).trim();
  // Handle European decimal comma: "1.234,56" → 1234.56
  const normalized = str.replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const n = parseFloat(normalized.replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function dateToYYYYMM(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    d = new Date(str);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
    const parts = str.split('/');
    const a = parseInt(parts[0]), b = parseInt(parts[1]), y = parseInt(parts[2]);
    // Treat as DD/MM/YYYY (European/SumUp format)
    d = a > 12 ? new Date(y, b - 1, a) : new Date(y, b - 1, a);
  } else {
    d = new Date(str);
  }
  if (!d || isNaN(d.getTime())) return null;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function parseCSV(buffer) {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes(';') ? ';' : ',';
  return lines.map(line => {
    const result = [];
    let inQ = false, field = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === delim && !inQ) { result.push(field.trim()); field = ''; }
      else { field += ch; }
    }
    result.push(field.trim());
    return result;
  });
}

function col(header, names) {
  for (const n of names) {
    const i = header.findIndex(h => h.includes(n));
    if (i !== -1) return i;
  }
  return -1;
}

export async function GET() {
  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    const listRes = await drive.files.list({
      q: `'${SUMUP_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime)',
      orderBy: 'modifiedTime asc',
    });

    const files = listRes.data.files || [];
    const sumupByMes = {};
    let totalRetiros = 0;

    for (const file of files) {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.xls')) continue;

      const fileRes = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const buffer = Buffer.from(fileRes.data);

      let rows;
      if (name.endsWith('.csv')) {
        rows = parseCSV(buffer);
      } else {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      }

      if (rows.length < 2) continue;
      const header = rows[0].map(h => String(h || '').toLowerCase().trim().replace(/\s+/g, ' '));

      const iDate  = col(header, ['fecha y hora', 'fecha', 'date', 'transaction date']);
      const iGross = col(header, ['monto de la transacción', 'monto bruto', 'gross amount', 'bruto', 'importe bruto', 'total price', 'precio total', 'amount']);
      const iFee   = col(header, ['monto de la comisión', 'comisión total', 'total commission', 'comisión', 'comision', 'commission', 'fee']);
      const iNet   = col(header, ['monto del depósito', 'monto neto', 'net amount', 'neto', 'net sales', 'net', 'total before deduction']);
      const iType  = col(header, ['tipo de transacción', 'transaction type', 'tipo']);
      const iState = col(header, ['estado', 'status']);

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(c => !c)) continue;

        const tipo = iType >= 0 ? String(row[iType] || '').toLowerCase().trim() : '';
        const isRetiro = tipo && (
          tipo.includes('retiro') || tipo.includes('withdrawal') ||
          tipo.includes('payout') || tipo.includes('depósito') ||
          tipo.includes('deposito') || tipo.includes('transferencia')
        );

        // Capture payout/withdrawal rows for SumUp balance calc
        if (isRetiro) {
          const brutoR = parseAmt(iGross >= 0 ? row[iGross] : 0);
          const netoR  = iNet >= 0 ? parseAmt(row[iNet]) : brutoR;
          totalRetiros += Math.abs(brutoR || netoR);
          continue;
        }

        // Only count completed payment transactions
        if (tipo && tipo !== 'pago') continue;
        if (iState >= 0) {
          const estado = String(row[iState] || '').toLowerCase().trim();
          if (estado && estado !== 'exitosa') continue;
        }

        const dateStr = iDate >= 0 ? String(row[iDate] || '') : file.modifiedTime;
        const monthKey = dateToYYYYMM(dateStr);
        if (!monthKey) continue;

        const bruto = parseAmt(iGross >= 0 ? row[iGross] : 0);
        const fee   = parseAmt(iFee >= 0 ? row[iFee] : 0);
        const neto  = iNet >= 0 ? parseAmt(row[iNet]) : Math.max(0, bruto - fee);

        if (bruto <= 0 && neto <= 0) continue;

        if (!sumupByMes[monthKey]) sumupByMes[monthKey] = { bruto: 0, comision: 0, neto: 0, transacciones: 0 };
        sumupByMes[monthKey].bruto        += bruto;
        sumupByMes[monthKey].comision     += fee;
        sumupByMes[monthKey].neto         += neto;
        sumupByMes[monthKey].transacciones++;
      }
    }

    return NextResponse.json({ sumupByMes, totalRetiros, sources: files.map(f => f.name) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
