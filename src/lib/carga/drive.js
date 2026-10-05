import 'server-only';
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { supabaseServidor } from '@/lib/supabase/server';
import { BUCKET } from './servidor';

/**
 * Copia un export de bills o multas a su carpeta de Drive, donde el reporte
 * de deudas lo lee hoy. Las carpetas deben estar en una Unidad compartida:
 * la cuenta de servicio no puede crear archivos en "Mi unidad" (ver
 * src/lib/tolls-snapshot.js). Sin carpeta configurada, se informa y no se copia.
 */
const CARPETAS = { bills: process.env.CARGA_DRIVE_BILLS_FOLDER_ID, fines: process.env.CARGA_DRIVE_FINES_FOLDER_ID };

export async function copiarADrive(carga) {
  const carpeta = CARPETAS[carga.tipo];
  if (!carpeta) return { copiado: false, motivo: 'sin_carpeta' };
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const { data, error } = await supabaseServidor().storage.from(BUCKET).download(carga.ruta_storage);
    if (error) throw new Error('storage');
    const drive = google.drive({ version: 'v3', auth });
    await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: carga.archivo, parents: [carpeta] },
      media: { mimeType: data.type || 'application/octet-stream', body: Readable.from(Buffer.from(await data.arrayBuffer())) },
    });
    return { copiado: true };
  } catch (err) {
    console.error('carga/drive', carga.tipo, err.message);
    return { copiado: false, motivo: 'error' };
  }
}
