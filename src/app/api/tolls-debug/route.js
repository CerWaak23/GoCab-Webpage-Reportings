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

export async function GET() {
  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    const listRes = await drive.files.list({
      q: `'${TOLLS_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime,size)',
      orderBy: 'modifiedTime desc',
    });

    const files = listRes.data.files || [];
    const result = { folder_id: TOLLS_FOLDER_ID, files: [], samples: [] };

    result.files = files.map(f => ({ name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, size: f.size }));

    // Read first file and return first 5 rows + header
    for (const file of files.slice(0, 2)) {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) continue;

      try {
        const fileRes = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        const buffer = Buffer.from(fileRes.data);

        let rows;
        if (name.endsWith('.csv')) {
          const text = buffer.toString('utf-8');
          rows = text.split(/\r?\n/).map(l => l.split(/[,;]/).map(c => c.replace(/^"|"$/g, '').trim()));
        } else {
          const wb = XLSX.read(buffer, { type: 'buffer' });
          // Return info about ALL sheets
          const sheetNames = wb.SheetNames;
          const sheetsPreview = {};
          for (const sn of sheetNames) {
            const sheet = wb.Sheets[sn];
            const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            sheetsPreview[sn] = sheetRows.slice(0, 6); // first 6 rows of each sheet
          }
          result.samples.push({ file: file.name, sheets: sheetNames, preview: sheetsPreview });
          continue;
        }

        result.samples.push({ file: file.name, header: rows[0], rows: rows.slice(1, 6) });
      } catch (e) {
        result.samples.push({ file: file.name, error: e.message });
      }
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
