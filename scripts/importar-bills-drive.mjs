/**
 * Guarda en Supabase la historia de los exports de bills que están en la
 * carpeta de Drive que lee el reporte de Bills: el último archivo de cada día
 * (igual que el reporte), del más antiguo al más nuevo.
 *
 *   npx vite-node --config vitest.config.mjs scripts/importar-bills-drive.mjs           (simula)
 *   npx vite-node --config vitest.config.mjs scripts/importar-bills-drive.mjs --aplicar
 *
 * Se puede repetir: los archivos ya guardados se saltan. No borra ni mueve
 * nada en Drive.
 */
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { leerFilas, billsDeFilas, ultimoPorDia } from '@/lib/bills/archivo';

process.loadEnvFile('.env.local');

const CARPETA = '1Fd3sia5XyN1tXuk2pvQfbrIbmV_o-sKh';
const aplicar = process.argv.includes('--aplicar');

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') },
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function bajar(f) {
  for (let intento = 0; ; intento++) {
    try {
      const res = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' });
      return Buffer.from(res.data);
    } catch (err) {
      if (intento >= 2) throw new Error(`No se pudo leer "${f.name}": ${err.message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const archivos = [];
let pageToken;
do {
  const r = await drive.files.list({
    q: `'${CARPETA}' in parents and trashed=false`,
    fields: 'files(id,name,modifiedTime),nextPageToken',
    orderBy: 'modifiedTime asc',
    pageSize: 1000,
    ...(pageToken ? { pageToken } : {}),
  });
  archivos.push(...(r.data.files || []));
  pageToken = r.data.nextPageToken;
} while (pageToken);

const tabulares = archivos.filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
const diarios = ultimoPorDia(tabulares);

// --referencias: completa qué bills trajo cada archivo ya importado antes de la
// migración 0010 (sin tocar las versiones).
if (process.argv.includes('--referencias')) {
  const { data: sinRefs, error: e0 } = await sb.from('bills_archivos').select('id, drive_id, archivo').is('referencias', null).not('drive_id', 'is', null);
  if (e0) throw new Error(e0.message);
  const porId = new Map(diarios.map((f) => [f.id, f]));
  let n = 0;
  for (const a of sinRefs) {
    const f = porId.get(a.drive_id);
    if (!f) continue;
    const refs = billsDeFilas(leerFilas(await bajar(f), f.name)).map((b) => b.referencia);
    const { error: e1 } = await sb.from('bills_archivos').update({ referencias: refs }).eq('id', a.id);
    if (e1) throw new Error(e1.message);
    process.stdout.write(`\r  ${++n}/${sinRefs.length} ${a.archivo}   `);
  }
  console.log(`\nReferencias completadas en ${n} archivos.`);
  process.exit(0);
}

const { data: ya, error } = await sb.from('bills_archivos').select('drive_id').not('drive_id', 'is', null);
if (error) throw new Error(error.message);
const guardados = new Set(ya.map((x) => x.drive_id));
const pendientes = diarios.filter((f) => !guardados.has(f.id));

console.log(`Drive: ${tabulares.length} exports · ${diarios.length} días (último archivo de cada día)`);
console.log(`Ya guardados: ${diarios.length - pendientes.length} · Por guardar: ${pendientes.length}`);
if (pendientes.length) console.log(`Desde ${pendientes[0].modifiedTime.slice(0, 10)} hasta ${pendientes.at(-1).modifiedTime.slice(0, 10)}`);


// De a 10 en paralelo para bajar, pero se guardan en orden: cada versión se
// compara con la anterior.
let nuevas = 0;
let cambios = 0;
for (let i = 0; i < pendientes.length; i += 10) {
  const lote = pendientes.slice(i, i + 10);
  const buffers = await Promise.all(lote.map(bajar));
  for (let j = 0; j < lote.length; j++) {
    const f = lote[j];
    const filas = billsDeFilas(leerFilas(buffers[j], f.name));
    if (!aplicar) {
      if (i + j < 3) console.log(`  ${f.modifiedTime.slice(0, 10)} ${f.name}: ${filas.length} bills`);
      continue;
    }
    const { data: r, error: e } = await sb.rpc('registrar_bills_version', {
      p_archivo: { archivo: f.name, driveId: f.id, subido: f.modifiedTime, origen: 'drive' },
      p_filas: filas,
    });
    if (e) throw new Error(`${f.name}: ${e.message}`);
    nuevas += r.nuevas ?? 0;
    cambios += r.cambios ?? 0;
    process.stdout.write(`\r  ${i + j + 1}/${pendientes.length} · ${f.modifiedTime.slice(0, 10)} · bills nuevas ${nuevas} · cambios ${cambios}   `);
  }
}
console.log(aplicar ? `\nListo: ${nuevas} bills nuevas y ${cambios} cambios guardados.` : '\nSimulación: no se guardó nada. Agrega --aplicar para guardar.');
