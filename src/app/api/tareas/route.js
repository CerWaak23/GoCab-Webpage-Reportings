export const dynamic = 'force-dynamic'; // never cache — always the latest shared state

import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { Readable } from 'stream';

// Carpeta de Drive donde viven las "mini bases de datos" (compartida con la service account como Editor)
const FOLDER_ID = '1vYtZQOuvCBovDsRCm6mBnWpBGP9YTeFn';

const noCache = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };

function getDrive() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

// doc → nombre de archivo seguro (un archivo por reporte). Ej: doc=operacionales → tareas-operacionales.json
function fileNameFor(doc) {
  const d = String(doc || 'operacionales').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'operacionales';
  return `tareas-${d}.json`;
}

async function findFile(drive, name) {
  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name='${name}' and trashed=false`,
    fields: 'files(id,name,modifiedTime)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  return (res.data.files && res.data.files[0]) || null;
}

// GET /api/tareas?doc=operacionales  → { exists, state, modifiedTime }
export async function GET(req) {
  try {
    const doc = new URL(req.url).searchParams.get('doc');
    const name = fileNameFor(doc);
    const drive = getDrive();
    if (new URL(req.url).searchParams.get('debug')) {
      const list = await drive.files.list({
        q: `'${FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,capabilities/canEdit)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      return NextResponse.json({ folder: FOLDER_ID, sees: list.data.files || [] }, { headers: noCache });
    }
    const file = await findFile(drive, name);
    if (!file) {
      return NextResponse.json({ exists: false, state: null }, { headers: noCache });
    }
    const media = await drive.files.get(
      { fileId: file.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );
    let state = null;
    try {
      state = typeof media.data === 'string' ? JSON.parse(media.data) : media.data;
    } catch {
      state = null;
    }
    return NextResponse.json(
      { exists: true, state, modifiedTime: file.modifiedTime },
      { headers: noCache }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500, headers: noCache });
  }
}

// POST /api/tareas?doc=operacionales  (body = objeto de estado)  → guarda en Drive
export async function POST(req) {
  try {
    const doc = new URL(req.url).searchParams.get('doc');
    const name = fileNameFor(doc);
    const body = await req.json();
    if (!body || typeof body !== 'object') throw new Error('Invalid body');
    const content = JSON.stringify(body);
    const drive = getDrive();
    let file = await findFile(drive, name);
    if (file) {
      await drive.files.update({
        fileId: file.id,
        media: { mimeType: 'application/json', body: Readable.from([content]) },
        supportsAllDrives: true,
      });
    } else {
      // Intenta crear el archivo en la carpeta (funciona en Shared Drives; en "Mi Drive" el
      // archivo debe existir previamente compartido como Editor con la service account).
      const created = await drive.files.create({
        requestBody: { name, parents: [FOLDER_ID], mimeType: 'application/json' },
        media: { mimeType: 'application/json', body: Readable.from([content]) },
        fields: 'id',
        supportsAllDrives: true,
      });
      file = created.data;
    }
    return NextResponse.json({ ok: true, id: file.id }, { headers: noCache });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500, headers: noCache });
  }
}
