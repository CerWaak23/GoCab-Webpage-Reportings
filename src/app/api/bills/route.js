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

    for (const file of files) {
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

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const ref = iRef >= 0 ? String(row[iRef] || '') : String(i);
        if (!ref) continue;

        const newPaid    = parseAmount(iPaid >= 0 ? row[iPaid] : 0);
        const newDriver  = iDriver >= 0 ? String(row[iDriver] || '').trim() : '';
        const newVehicle = iVehicle >= 0 ? String(row[iVehicle] || '').trim() : '';
        const newType    = iType >= 0 ? String(row[iType] || '').trim() : '';
        const newAmount  = parseAmount(iAmount >= 0 ? row[iAmount] : 0);

        // Detect payment: paidAmount increased vs previous version of this bill
        if (billsMap.has(ref)) {
          const prev = billsMap.get(ref);
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
      sources: files.map((f) => f.name),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
