export const dynamic = 'force-dynamic'; // never cache — always fetch latest from Drive

import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

const FINES_FOLDER_ID = '1O5GblTXWQI_6RBn7072am1nprtZYcvJ7';

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

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Clave de una multa.
 *
 * En este archivo "Reference" NO es un identificador: es texto libre escrito a
 * mano. "GARANTIA" aparece 10 veces y "MULTA POR VIA EXCLUSIVA" 3, cada una de
 * un conductor distinto. Usarla como llave —como se hace con Bills— fundiría 13
 * filas en 2 y borraría la deuda de 11 personas.
 *
 * La combinación referencia + patente + monto + fecha de la contravención sí es
 * única en los datos reales (35 filas → 35 claves).
 */
function fineKey(ref, vehicle, payroll, dateContravention) {
  return [clean(ref), clean(vehicle).toUpperCase(), payroll, clean(dateContravention).slice(0, 10)].join('|');
}

export async function GET() {
  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Oldest→newest: cada archivo pisa al anterior, y la transición de estado
    // entre versiones es la que delata el pago.
    const listRes = await drive.files.list({
      q: `'${FINES_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime),nextPageToken',
      orderBy: 'modifiedTime asc',
      pageSize: 1000,
      quotaUser: `gc-${Date.now()}`,
    });
    const files = listRes.data.files || [];

    const finesMap = new Map();   // key → estado más reciente de la multa
    const paymentEvents = [];     // pagos detectados al pasar de pending a completed

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
        const text = buffer.toString('utf-8');
        const lines = text.split(/\r?\n/);
        const delim = lines[0]?.includes(';') ? ';' : ',';
        rows = lines.map((l) => l.split(delim).map((c) => c.replace(/^"|"$/g, '').trim()));
      } else {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      }
      if (rows.length < 2) continue;

      const header = rows[0].map((h) => String(h).toLowerCase().trim());
      const col = (names) => {
        for (const n of names) {
          const i = header.findIndex((h) => h.includes(n));
          if (i !== -1) return i;
        }
        return -1;
      };

      const iRef     = col(['reference', 'ref']);
      // "Payroll amount" es lo que se le cobra al conductor; "Amount" viene en 0
      // hasta que la multa se paga, y ahí queda igual al payroll. Ojo con el orden:
      // 'amount' calzaría con 'payroll amount', así que el payroll se busca primero.
      const iPayroll = col(['payroll amount', 'payroll']);
      const iAmount  = header.findIndex((h) => h.trim() === 'amount');
      const iStatus  = col(['status', 'estado']);
      const iVehicle = col(['vehicle', 'vehículo', 'vehiculo', 'patente']);
      const iDriver  = col(['driver', 'conductor']);
      const iComment = col(['comment', 'comentario']);
      const iReason  = col(['raison', 'reason', 'motivo']);
      const iDateCon = col(['date of contravention', 'contravention', 'fecha de infracción']);
      const iCreated = col(['created at', 'created']);

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const ref = iRef >= 0 ? clean(row[iRef]) : '';
        if (!ref) continue;

        const vehicle = iVehicle >= 0 ? clean(row[iVehicle]).toUpperCase() : '';
        const payroll = parseAmount(iPayroll >= 0 ? row[iPayroll] : 0);
        const dateCon = iDateCon >= 0 ? clean(row[iDateCon]) : '';
        const key = fineKey(ref, vehicle, payroll, dateCon);

        const prev = finesMap.get(key) || null;
        const paid = parseAmount(iAmount >= 0 ? row[iAmount] : 0);
        const status = (iStatus >= 0 ? clean(row[iStatus]) : '').toLowerCase();
        const driver = (iDriver >= 0 ? clean(row[iDriver]) : '') || (prev?.driver || '');
        const createdAt = iCreated >= 0 ? clean(row[iCreated]) : '';

        // Una multa cuenta como pagada cuando su Amount sube. El estado "completed"
        // acompaña, pero el monto es el dato duro: así también se captan pagos
        // parciales si algún día el archivo los trae.
        if (prev) {
          const delta = paid - prev.paidAmount;
          if (delta > 0) {
            paymentEvents.push({
              reference: key,
              driver: driver || prev.driver,
              vehicle: vehicle || prev.vehicle,
              amount: delta,
              date: file.modifiedTime, // el archivo es lo único que fecha el pago
              type: 'Multa',
            });
          }
        } else if (paid > 0) {
          // Ya venía pagada la primera vez que la vemos: no hay con qué comparar.
          // Se fecha en la creación de la multa, no en la subida del archivo, para
          // no inventar un peak de pagos el día que se cargó el histórico.
          const fecha = createdAt || dateCon;
          if (fecha) {
            paymentEvents.push({
              reference: key,
              driver,
              vehicle,
              amount: paid,
              date: fecha,
              type: 'Multa',
            });
          }
        }

        finesMap.set(key, {
          reference: key,
          refOriginal: ref,
          type: 'Multa',
          status,
          vehicle,
          driver,
          amount: payroll,          // lo que se le carga al conductor
          paidAmount: paid,         // lo que ya se pagó
          description: [iReason >= 0 ? clean(row[iReason]) : '', iComment >= 0 ? clean(row[iComment]) : '']
            .filter(Boolean).join(' · '),
          createdAt,
          dateContravention: dateCon,
        });
      }
    }

    const fines = Array.from(finesMap.values());
    const totalCharged = fines.reduce((s, f) => s + f.amount, 0);
    const totalPaid = fines.reduce((s, f) => s + f.paidAmount, 0);

    return NextResponse.json(
      {
        fines,
        paymentEvents,
        totals: {
          count: fines.length,
          unpaidCount: fines.filter((f) => f.amount - f.paidAmount > 0).length,
          totalCharged,
          totalPaid,
          totalPending: Math.max(0, totalCharged - totalPaid),
        },
        _fetchedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
