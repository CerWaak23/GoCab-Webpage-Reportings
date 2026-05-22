import { google } from 'googleapis';
import { NextResponse } from 'next/server';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Missing Google credentials: set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY');
  }
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
}

export async function GET(request, { params }) {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const { fileId } = params;

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: fileId,
      fields: 'sheets.properties',
    });
    const sheetNames = meta.data.sheets.map((s) => s.properties.title);

    const url = new URL(request.url);
    const range = url.searchParams.get('range');

    if (range) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: fileId,
        range,
      });
      return NextResponse.json({ rows: res.data.values || [], sheets: sheetNames });
    }

    // Return first sheet by default
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: fileId,
      range: sheetNames[0],
    });
    return NextResponse.json({ rows: res.data.values || [], sheets: sheetNames });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
