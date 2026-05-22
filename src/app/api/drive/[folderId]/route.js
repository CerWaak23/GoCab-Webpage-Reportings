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
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

export async function GET(request, { params }) {
  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });
    const { folderId } = params;

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,modifiedTime)',
      orderBy: 'modifiedTime desc',
    });

    return NextResponse.json({ files: res.data.files || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
