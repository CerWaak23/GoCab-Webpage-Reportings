import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

const BILLS_FOLDER_ID = '1Fd3sia5XyN1tXuk2pvQfbrIbmV_o-sKh';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Missing Google credentials: set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY');
  }
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ── HTML-in-cells parser ───────────────────────────────────────────────────────
// Some exports (e.g. GoCab billing system) dump a full HTML table into an Excel
// where every row in column A is one line of raw HTML.  We detect this case and
// parse the embedded table instead of treating the cells as normal data.

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')        // remove all tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function isHtmlFile(rows) {
  // Check if first few non-empty cells look like HTML markup
  const sample = rows.slice(0, 10).flat().filter(Boolean).map(String);
  return sample.some(c => /^<(tr|td|table|thead|tbody)/i.test(c.trim()));
}

function parseHtmlRows(rows) {
  // Concatenate all cells into one HTML string
  const html = rows.map(r => r.join('')).join('\n');

  // Extract every <tr> block
  const tableRows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM;
  while ((trM = trRe.exec(html)) !== null) {
    const cells = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;  // match <td> and <th>
    let tdM;
    while ((tdM = tdRe.exec(trM[1])) !== null) {
      cells.push(stripHtml(tdM[1]));
    }
    if (cells.some(c => c)) tableRows.push(cells);
  }
  return tableRows;
}

export async function GET() {
  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Files ordered oldest→newest so each iteration overwrites with fresher data
    const listRes = await drive.files.list({
      q: `'${BILLS_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime)',
      orderBy: 'modifiedTime asc',
    });

    const files = listRes.data.files || [];
    const billsMap = new Map();      // ref → latest bill state
    const paymentEvents = [];        // payment deltas detected between file versions
    const snapshots = [];            // recovery-rate snapshot after each file
    const dataWarnings = [];         // data-quality issues detected per file

    for (const file of files) {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) continue;

      const fileRes = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      const buffer = Buffer.from(fileRes.data);
      let rows;
      if (name.endsWith('.csv')) {
        // CSV: read as text and split
        const text = buffer.toString('utf-8');
        const lines = text.split(/\r?\n/);
        const delim = lines[0]?.includes(';') ? ';' : ',';
        rows = lines.map(l => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim()));
      } else {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      }

      // Detect HTML-in-cells format and re-parse if needed
      if (isHtmlFile(rows)) rows = parseHtmlRows(rows);

      if (rows.length < 2) continue;
      const header = rows[0].map((h) => String(h).toLowerCase().trim());

      const col = (names) => {
        for (const n of names) {
          const i = header.findIndex((h) => h.includes(n));
          if (i !== -1) return i;
        }
        return -1;
      };

      const iRef    = col(['reference', 'ref']);
      const iType   = col(['type', 'tipo']);
      const iStatus = col(['status', 'estado']);
      const iVehicle = col(['vehicle', 'vehículo', 'vehiculo']);
      const iDriver = col(['driver', 'conductor']);
      const iPhone  = col(['phone', 'teléfono', 'telefono']);
      const iAmount = col(['amount', 'monto', 'total']);
      const iPaid   = col(['paid amount', 'paid', 'pagado']);
      const iDesc   = col(['description', 'descripción', 'descripcion']);
      const iDate   = col(['created at', 'created', 'fecha']);

      let fileDataRows = 0;
      let fileEmptyDriverRows = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const ref = iRef >= 0 ? String(row[iRef] || '') : String(i);
        if (!ref) continue;

        const prev = billsMap.get(ref) || null;

        const newPaid    = parseAmount(iPaid >= 0 ? row[iPaid] : 0);
        // Preserve driver/vehicle from the previous version of this bill when
        // the current file has those fields empty (e.g. a re-export that omits columns).
        const rawDriver  = iDriver >= 0 ? String(row[iDriver] || '').trim() : '';
        const rawVehicle = iVehicle >= 0 ? String(row[iVehicle] || '').trim() : '';
        const newDriver  = rawDriver  || (prev?.driver  || '');
        const newVehicle = rawVehicle || (prev?.vehicle || '');
        const newType    = iType >= 0 ? String(row[iType] || '').trim() : '';
        const newAmount  = parseAmount(iAmount >= 0 ? row[iAmount] : 0);

        fileDataRows++;
        if (!rawDriver) fileEmptyDriverRows++;

        // Detect payment: paidAmount increased vs previous version of this bill
        if (prev) {
          const delta = newPaid - prev.paidAmount;
          if (delta > 0) {
            paymentEvents.push({
              reference: ref,
              driver: newDriver || prev.driver,
              vehicle: newVehicle || prev.vehicle,
              amount: delta,
              date: file.modifiedTime, // ISO datetime of the file upload
              type: newType || prev.type,
            });
          }
        }

        billsMap.set(ref, {
          reference: ref,
          type: newType,
          status: iStatus >= 0 ? String(row[iStatus] || '') : '',
          vehicle: newVehicle,
          driver: newDriver,
          phone: iPhone >= 0 ? String(row[iPhone] || '') : '',
          amount: newAmount,
          paidAmount: newPaid,
          description: iDesc >= 0 ? String(row[iDesc] || '') : '',
          createdAt: iDate >= 0 ? String(row[iDate] || '') : '',
        });
      }

      // Data-quality check: flag files where driver column is mostly empty
      if (fileDataRows >= 5 && fileEmptyDriverRows / fileDataRows > 0.8) {
        dataWarnings.push({
          file: file.name,
          date: file.modifiedTime,
          issue: 'empty_drivers',
          emptyDriverPct: Math.round(fileEmptyDriverRows / fileDataRows * 100),
          totalRows: fileDataRows,
        });
      }

      // Snapshot: total recovery state after processing this file
      let snapCharged = 0, snapPaid = 0;
      for (const bill of billsMap.values()) {
        snapCharged += bill.amount;
        snapPaid += bill.paidAmount;
      }
      snapshots.push({
        date: file.modifiedTime,
        name: file.name,
        totalCharged: snapCharged,
        totalPaid: snapPaid,
      });
    }

    return NextResponse.json({
      bills: Array.from(billsMap.values()),
      paymentEvents,
      snapshots,
      dataWarnings,
      sources: files.map((f) => f.name),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
