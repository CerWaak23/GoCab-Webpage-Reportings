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

    const url = new URL(request.url);
    const range = url.searchParams.get('range');

    // Get sheet names first
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: fileId,
      fields: 'sheets.properties',
    });
    const sheetNames = meta.data.sheets.map((s) => s.properties.title);
    const targetRange = range || sheetNames[0];

    // Use includeGridData to capture embedded hyperlinks alongside cell values
    const gridRes = await sheets.spreadsheets.get({
      spreadsheetId: fileId,
      ranges: [targetRange],
      includeGridData: true,
      fields: 'sheets.data.rowData.values(formattedValue,hyperlink)',
    });

    const rowData = gridRes.data.sheets?.[0]?.data?.[0]?.rowData || [];

    // Build plain rows (string[][]) — backwards-compatible with existing callers
    const rows = rowData.map((row) =>
      (row.values || []).map((cell) => cell.formattedValue ?? '')
    );

    // Build hyperlinks (string|null)[][] — parallel structure; null = no hyperlink
    const hyperlinks = rowData.map((row) =>
      (row.values || []).map((cell) => cell.hyperlink || null)
    );

    return NextResponse.json({ rows, hyperlinks, sheets: sheetNames });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
