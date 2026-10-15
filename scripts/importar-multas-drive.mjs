/**
 * Guarda en Supabase la historia de los exports de multas de la carpeta de
 * Drive que lee el reporte de multas: todos los archivos, del más antiguo al
 * más nuevo (el reporte de multas no se queda con uno por día).
 *
 *   npx vite-node --config vitest.config.mjs scripts/importar-multas-drive.mjs           (simula)
 *   npx vite-node --config vitest.config.mjs scripts/importar-multas-drive.mjs --aplicar
 *
 * Se puede repetir: los archivos ya guardados se saltan. No toca Drive.
 */
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { leerFilas } from '@/lib/bills/archivo';
import { multasDeFilas } from '@/lib/multas/reporte';

process.loadEnvFile('.env.local');

const CARPETA = '1O5GblTXWQI_6RBn7072am1nprtZYcvJ7';
const aplicar = process.argv.includes('--aplicar');

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\n/g, '\n') },
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const { data: lista } = await drive.files.list({
  q: `'${CARPETA}' in parents and trashed=false`,
  fields: 'files(id,name,modifiedTime)',
  orderBy: 'modifiedTime asc',
  pageSize: 1000,
});
const tabulares = (lista.files || []).filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));

const { data: ya, error } = await sb.from('multas_archivos').select('drive_id').not('drive_id', 'is', null);
if (error) throw new Error(error.message);
const guardados = new Set(ya.map((x) => x.drive_id));
const pendientes = tabulares.filter((f) => !guardados.has(f.id));
console.log(`Drive: ${tabulares.length} exports · ya guardados ${tabulares.length - pendientes.length} · por guardar ${pendientes.length}`);

let nuevas = 0;
let cambios = 0;
for (const [i, f] of pendientes.entries()) {
  const { data } = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' });
  const leido = multasDeFilas(leerFilas(Buffer.from(data), f.name, { html: false }));
  if (!aplicar) {
    if (i < 3) console.log(`  ${f.modifiedTime.slice(0, 10)} ${f.name}: ${leido.filas.length} multas${leido.formatoDesconocido ? ' (formato desconocido)' : ''}`);
    continue;
  }
  const { data: r, error: e } = await sb.rpc('registrar_multas_version', {
    p_archivo: { archivo: f.name, driveId: f.id, subido: f.modifiedTime, origen: 'drive', formatoDesconocido: leido.formatoDesconocido, encabezado: leido.encabezado },
    p_filas: leido.filas,
  });
  if (e) throw new Error(`${f.name}: ${e.message}`);
  nuevas += r.nuevas ?? 0;
  cambios += r.cambios ?? 0;
  process.stdout.write(`\r  ${i + 1}/${pendientes.length} · ${f.modifiedTime.slice(0, 10)} · multas nuevas ${nuevas} · cambios ${cambios}   `);
}
console.log(aplicar ? `\nListo: ${nuevas} multas nuevas y ${cambios} cambios guardados.` : '\nSimulación: no se guardó nada. Agrega --aplicar para guardar.');
