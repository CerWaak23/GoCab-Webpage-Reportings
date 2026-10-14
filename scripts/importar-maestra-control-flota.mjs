/**
 * Parte la maestra sin perder lo que los coordinadores ya corrigieron a mano
 * en la hoja "Vehiculos y ConductoresII": donde la hoja dice otra cosa que
 * Fleet (RUT, encargado, tipo o nombre), se guarda como corrección.
 *
 *   npx vite-node --config vitest.config.mjs scripts/importar-maestra-control-flota.mjs           (simula)
 *   npx vite-node --config vitest.config.mjs scripts/importar-maestra-control-flota.mjs --aplicar
 *
 * Correr después de cargar drivers y vehicles. Se puede repetir: lo que ya
 * calza no genera otra corrección.
 */
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { construirMaestra, edicionesDesdeHoja } from '@/lib/maestra/maestra';

process.loadEnvFile('.env.local');

const HOJA = '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw';
const PESTANA = 'Vehiculos y ConductoresII';
const AUTOR = 'importado@gocab.io';
const aplicar = process.argv.includes('--aplicar');

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const { data: hoja } = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({ spreadsheetId: HOJA, range: `'${PESTANA}'` });
const [cab, ...cuerpo] = hoja.values;
const filasHoja = cuerpo.map((r) => Object.fromEntries(cab.map((h, i) => [String(h).trim(), r[i] ?? ''])));

const leer = async (q) => { const r = await q; if (r.error) throw new Error(r.error.message); return r.data; };
const [autos, conductores, vigentes, anteriores, ediciones, cfg] = await Promise.all([
  leer(sb.from('autos').select('patente, estado_fleet, grupo, modalidad')),
  leer(sb.from('conductores').select('id, nombre, nombre_fleet, rut, rut_crudo, activacion, creado_fleet, modalidad')),
  leer(sb.from('asignaciones').select('patente, conductor_id').is('hasta', null)),
  leer(sb.from('asignaciones').select('patente, conductor_id, hasta').not('hasta', 'is', null)),
  leer(sb.from('maestra_ediciones').select('patente, conductor_id, campo, valor, autor_email, creado')),
  leer(sb.from('configuracion').select('valor').eq('clave', 'maestra_encargados').maybeSingle()),
]);
if (autos.length === 0) throw new Error('La base no tiene autos: carga primero drivers y vehicles.');

const maestra = construirMaestra({ autos, conductores, vigentes, anteriores, ediciones, encargados: cfg?.valor ?? {} });
const nuevas = edicionesDesdeHoja(maestra, filasHoja);

const porCampo = {};
for (const e of nuevas) porCampo[e.campo] = (porCampo[e.campo] || 0) + 1;
const enHoja = new Set(filasHoja.map((h) => String(h.Vehicles).toUpperCase().replace(/[^A-Z0-9]/g, '')));
console.log(`Hoja: ${filasHoja.length} filas · Maestra: ${maestra.length} autos`);
console.log('Autos en la maestra que no están en la hoja:', maestra.filter((f) => !enHoja.has(f.patente)).map((f) => f.patente).join(', ') || 'ninguno');
console.log('Correcciones a importar por campo:', porCampo);

if (!aplicar) {
  console.log('\nSimulación: no se guardó nada. Agrega --aplicar para guardar.');
} else if (nuevas.length) {
  const { error } = await sb.from('maestra_ediciones').insert(nuevas.map((e) => ({
    patente: e.patente ?? null, conductor_id: e.conductor_id ?? null, campo: e.campo, valor: e.valor, autor_email: AUTOR,
  })));
  if (error) throw new Error(error.message);
  console.log(`\nGuardadas ${nuevas.length} correcciones.`);
}
