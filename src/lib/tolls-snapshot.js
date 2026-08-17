/**
 * Snapshots de peajes guardados como JSON en una carpeta de Google Drive.
 *
 * Por qué Drive y no un store nuevo: la service account y googleapis ya están
 * en el proyecto, así que no agrega infraestructura ni dependencias — y el plan
 * es Hobby, donde conviene no sumar servicios.
 *
 * Cómo se guarda: dos archivos de nombre fijo dentro de la carpeta que indique
 * TOLLS_SNAPSHOT_FOLDER_ID. Se actualizan en el sitio (files.update); solo se
 * crean la primera vez. Si la creación falla porque la service account no tiene
 * cuota propia de Drive — el error clásico "Service Accounts do not have storage
 * quota" —, el mensaje te dice que crees el archivo a mano una sola vez: sobre
 * un archivo que ya existe y es tuyo, actualizar no consume cuota de la cuenta
 * de servicio.
 */

import { google } from 'googleapis';

export const SNAPSHOT_FILES = {
  index:  'gocab-tolls-index.json',
  plates: 'gocab-tolls-plates.json',
};

function credentials() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  return { client_email: email, private_key: key };
}

function driveClient(readOnly) {
  const auth = new google.auth.GoogleAuth({
    credentials: credentials(),
    // Escritura solo donde hace falta. El lector sigue con readonly.
    scopes: [readOnly
      ? 'https://www.googleapis.com/auth/drive.readonly'
      : 'https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

export function snapshotFolderId() {
  return process.env.TOLLS_SNAPSHOT_FOLDER_ID || '';
}

/** true si el proyecto está configurado para usar snapshots. */
export function snapshotsEnabled() {
  return Boolean(snapshotFolderId());
}

async function findFile(drive, name) {
  const folderId = snapshotFolderId();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name = '${name}' and trashed = false`,
    fields: 'files(id,name,modifiedTime,size)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

// ── Escritura ─────────────────────────────────────────────────────────────────

/**
 * Guarda un snapshot. Devuelve { fileId, bytes, created }.
 */
export async function writeSnapshot(kind, data) {
  const name = SNAPSHOT_FILES[kind];
  if (!name) throw new Error(`Snapshot desconocido: ${kind}`);
  if (!snapshotsEnabled()) throw new Error('TOLLS_SNAPSHOT_FOLDER_ID no está configurada');

  const drive = driveClient(false);
  const body = JSON.stringify(data);
  const media = { mimeType: 'application/json', body };

  const existing = await findFile(drive, name);

  if (existing) {
    await drive.files.update({ fileId: existing.id, media });
    return { fileId: existing.id, bytes: body.length, created: false };
  }

  try {
    const res = await drive.files.create({
      requestBody: { name, parents: [snapshotFolderId()], mimeType: 'application/json' },
      media,
      fields: 'id',
    });
    return { fileId: res.data.id, bytes: body.length, created: true };
  } catch (e) {
    if (/storage quota/i.test(e.message || '')) {
      throw new Error(
        `No se pudo crear "${name}": las service accounts no tienen cuota propia en Drive. ` +
        `Crea el archivo a mano una vez dentro de la carpeta de snapshots (puede ir vacío) ` +
        `y vuelve a lanzar el cron — actualizarlo después ya no consume cuota.`
      );
    }
    throw e;
  }
}

// ── Lectura ───────────────────────────────────────────────────────────────────

// Memo por instancia: evita volver a bajar el JSON mientras el archivo no cambie.
// La clave es el modifiedTime que reporta Drive, así que un cron nuevo lo invalida
// solo. Listar metadatos es una llamada barata; bajar 4 MB no lo es.
const memo = new Map(); // kind → { key, data, checkedAt }

// Ni siquiera la comprobación de metadatos hace falta en cada visita: el cron
// escribe una vez al día. Sin esta ventana, cada carga de página gastaba una
// llamada a la API de Drive solo para preguntar algo que casi nunca cambia.
const CHECK_TTL_MS = 60 * 1000;

/**
 * Lee un snapshot. Devuelve null si no está configurado o el archivo no existe
 * todavía, para que quien llame pueda decidir su plan B.
 */
export async function readSnapshot(kind) {
  const name = SNAPSHOT_FILES[kind];
  if (!name) throw new Error(`Snapshot desconocido: ${kind}`);
  if (!snapshotsEnabled()) return null;

  const cached = memo.get(kind);
  if (cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) return cached.data;

  const drive = driveClient(true);
  const meta = await findFile(drive, name);
  if (!meta) return cached?.data ?? null;

  if (cached && cached.key === meta.modifiedTime) {
    cached.checkedAt = Date.now();
    return cached.data;
  }

  const res = await drive.files.get(
    { fileId: meta.id, alt: 'media' },
    { responseType: 'text' }
  );

  const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  memo.set(kind, { key: meta.modifiedTime, data, checkedAt: Date.now() });
  return data;
}

/**
 * Transacciones de una sola patente, sin bajar el resto a quien pregunta.
 * Devuelve null si todavía no hay snapshot.
 */
export async function readPlateTransactions(plate) {
  const snap = await readSnapshot('plates');
  if (!snap) return null;
  return {
    transactions: snap.byPlate?.[plate] || [],
    autopistas:   snap.autopistas  || [],
    porticos:     snap.porticos    || [],
    tipoTarifas:  snap.tipoTarifas || [],
    generatedAt:  snap.generatedAt || null,
  };
}
