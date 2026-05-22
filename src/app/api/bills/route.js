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

export async function GET() {
  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // List XLSX (and XLS) files in the bills folder
    const listRes = await drive.files.list({
      q: `'${BILLS_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime)',
      orderBy: 'modifiedTime asc',
    });

    const files = listRes.data.files || [];
    const billsMap = new Map();

    for (const file of files) {
      // Skip non-spreadsheet files
      const name = file.name.toLowerCase();
      if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) continue;

      const fileRes = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      const buffer = Buffer.from(fileRes.data);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      // Row 0 is header — detect column positions dynamically
      if (rows.length < 2) continue;
      const header = rows[0].map((h) => String(h).toLowerCase().trim());

      const col = (names) => {
        for (const n of names) {
          const i = header.findIndex((h) => h.includes(n));
          if (i !== -1) return i;
        }
        return -1;
      };

      const iRef = col(['reference', 'ref']);
      const iType = col(['type', 'tipo']);
      const iStatus = col(['status', 'estado']);
      const iVehicle = col(['vehicle', 'vehículo', 'vehiculo']);
      const iDriver = col(['driver', 'conductor']);
      const iPhone = col(['phone', 'teléfono', 'telefono']);
      const iAmount = col(['amount', 'monto', 'total']);
      const iPaid = col(['paid amount', 'paid', 'pagado']);
      const iDesc = col(['description', 'descripción', 'descripcion']);
      const iDate = col(['created at', 'created', 'fecha']);

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const ref = iRef >= 0 ? String(row[iRef] || '') : String(i);
        if (!ref || ref === '') continue;

        billsMap.set(ref, {
          reference: ref,
          type: iType >= 0 ? String(row[iType] || '') : '',
          status: iStatus >= 0 ? String(row[iStatus] || '') : '',
          vehicle: iVehicle >= 0 ? String(row[iVehicle] || '') : '',
          driver: iDriver >= 0 ? String(row[iDriver] || '') : '',
          phone: iPhone >= 0 ? String(row[iPhone] || '') : '',
          amount: parseAmount(iAmount >= 0 ? row[iAmount] : 0),
          paidAmount: parseAmount(iPaid >= 0 ? row[iPaid] : 0),
          description: iDesc >= 0 ? String(row[iDesc] || '') : '',
          createdAt: iDate >= 0 ? String(row[iDate] || '') : '',
        });
      }
    }

    return NextResponse.json({
      bills: Array.from(billsMap.values()),
      sources: files.map((f) => f.name),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
