/**
 * Importa la pestaña "VEHÍCULOS EN TALLER" de Control Flota como pasos por
 * taller de GoBills (una vez, al reemplazar la planilla).
 *
 *   npx vite-node --config vitest.config.mjs scripts/importar-talleres-control-flota.mjs           (simula)
 *   npx vite-node --config vitest.config.mjs scripts/importar-talleres-control-flota.mjs --aplicar
 *
 * Idempotente: cada paso guarda su número de fila y no se vuelve a importar.
 */
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { pasoDesdeFila, TALLERES_NUEVOS } from '@/lib/historial/importarTalleres';
import { crearIndice, buscarConductor } from '@/lib/fleet/identidad';

process.loadEnvFile('.env.local');
const APLICAR = process.argv.includes('--aplicar');
const HOJA = '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw';
const PESTANA = 'VEHÍCULOS EN TALLER';
const AUTOR = 'importado:control-flota';

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const { data: hoja } = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({ spreadsheetId: HOJA, range: `'${PESTANA}'` });
const [cabecera, ...filas] = hoja.values;
// La columna de avances trae su fecha en el título ("Avances 05/10").
const m = /(\d{1,2})\/(\d{1,2})/.exec(cabecera[6] || '');
const fechaAvances = m ? `2026-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : new Date().toISOString().slice(0, 10);

const pasos = [];
const errores = [];
filas.forEach((f, i) => {
  if (!f.some((c) => String(c).trim())) return;
  const p = pasoDesdeFila(f, i + 2, fechaAvances);
  (p.error ? errores : pasos).push(p);
});

const [{ data: autos }, { data: conductores }, { data: catalogo }, { data: yaImportados }] = await Promise.all([
  sb.from('autos').select('patente'),
  sb.from('conductores').select('id, nombre, telefono, patentes_fleet'),
  sb.from('talleres').select('id, nombre'),
  sb.from('eventos').select('detalle').eq('tipo', 'taller').eq('detalle->>importado', 'control_flota'),
]);
const existe = new Set(autos.map((a) => a.patente));
const hechas = new Set(yaImportados.map((e) => e.detalle.filaHoja));
const indice = crearIndice(conductores.map((c) => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, patentes: c.patentes_fleet })));

let cruzados = 0;
for (const p of pasos) {
  const r = p.conductorTexto ? buscarConductor({ nombre: p.conductorTexto, patente: p.patente }, indice) : null;
  p.conductorId = r?.id ?? null;
  if (r?.id) cruzados += 1;
  // Solo nombre de pila o ex conductor que ya no está en Fleet: se conserva como venía.
  else if (p.conductorTexto) p.detalle.conductorHoja = p.conductorTexto;
}

const nuevos = pasos.filter((p) => !hechas.has(p.detalle.filaHoja) && existe.has(p.patente));
const resumen = {
  filas: pasos.length + errores.length,
  errores: errores.map((e) => `fila ${e.n}: ${e.error}`),
  fuera_de_flota: pasos.filter((p) => !existe.has(p.patente)).map((p) => p.patente),
  ya_importados: pasos.filter((p) => hechas.has(p.detalle.filaHoja)).length,
  a_importar: nuevos.length,
  abiertos: nuevos.filter((p) => p.abierto).length,
  cerrados: nuevos.filter((p) => !p.abierto).length,
  con_actualizacion: nuevos.filter((p) => p.actualizacion).length,
  conductor_identificado: `${cruzados} de ${pasos.filter((p) => p.conductorTexto).length}`,
  por_taller: nuevos.reduce((a, p) => ({ ...a, [p.detalle.taller]: (a[p.detalle.taller] || 0) + 1 }), {}),
  por_motivo: nuevos.reduce((a, p) => ({ ...a, [p.detalle.motivo]: (a[p.detalle.motivo] || 0) + 1 }), {}),
};
console.log(JSON.stringify(resumen, null, 2));

if (!APLICAR) {
  console.log('\nSimulación: no se escribió nada. Agrega --aplicar para importar.');
  process.exit(0);
}

// Talleres que faltan en el catálogo.
const faltan = TALLERES_NUEVOS.filter((t) => !catalogo.some((c) => c.nombre === t.nombre));
if (faltan.length) {
  const { error } = await sb.from('talleres').insert(faltan);
  if (error) throw error;
}
const { data: talleres } = await sb.from('talleres').select('id, nombre');
const idTaller = new Map(talleres.map((t) => [t.nombre, t.id]));

let ok = 0;
for (const p of nuevos) {
  const { data: ev, error } = await sb.from('eventos').insert({
    patente: p.patente,
    conductor_id: p.conductorId,
    tipo: 'taller',
    fecha: p.detalle.ingreso,
    usuario_email: AUTOR,
    detalle: { ...p.detalle, tallerId: idTaller.get(p.detalle.taller) || null },
  }).select('id').single();
  if (error) {
    console.error(p.patente, 'fila', p.detalle.filaHoja, error.message);
    continue;
  }
  if (p.actualizacion) {
    const { error: e2 } = await sb.from('taller_actualizaciones')
      .insert({ evento_id: ev.id, fecha: p.actualizacion.fecha, autor_email: AUTOR, texto: p.actualizacion.texto });
    if (e2) console.error(p.patente, 'actualización', e2.message);
  }
  ok += 1;
}
console.log(`\nImportados ${ok} de ${nuevos.length} pasos por taller.`);
