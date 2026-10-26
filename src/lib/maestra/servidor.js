import 'server-only';
import { google } from 'googleapis';
import { supabaseServidor } from '@/lib/supabase/server';
import { construirMaestra, filasHoja, diferenciasConHoja, CAMPOS_AUTO } from './maestra';

export const HOJA_ID = '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw';
/**
 * Pestaña donde GoBills escribe la maestra. Parte en una pestaña nueva para
 * compararla con "Vehiculos y ConductoresII" sin tocarla; cuando calcen se
 * cambia la clave maestra_hoja de configuracion a esa pestaña.
 */
export const PESTANA_INICIAL = 'Maestra GoBills';
/** La pestaña que se mantenía a mano y que leen Copec, Vortex e inDrive. */
export const PESTANA_ORIGINAL = 'Vehiculos y ConductoresII';

async function config(sb, clave, defecto) {
  const { data } = await sb.from('configuracion').select('valor').eq('clave', clave).maybeSingle();
  return data?.valor ?? defecto;
}

/** Todo lo que necesita construirMaestra, leído de la base. */
export async function datosMaestra() {
  const sb = supabaseServidor();
  const [autos, conductores, vigentes, anteriores, ediciones] = await Promise.all([
    sb.from('autos').select('patente, estado_fleet, grupo, modalidad'),
    sb.from('conductores').select('id, nombre, nombre_fleet, rut, rut_crudo, activacion, creado_fleet, modalidad'),
    sb.from('asignaciones').select('patente, conductor_id').is('hasta', null),
    sb.from('asignaciones').select('patente, conductor_id, hasta').not('hasta', 'is', null),
    sb.from('maestra_ediciones').select('patente, conductor_id, campo, valor, autor_email, creado').order('creado'),
  ]);
  for (const r of [autos, conductores, vigentes, anteriores, ediciones]) if (r.error) throw new Error('No se pudo leer la base');
  return {
    autos: autos.data,
    conductores: conductores.data,
    vigentes: vigentes.data,
    anteriores: anteriores.data,
    ediciones: ediciones.data,
    encargados: await config(sb, 'maestra_encargados', {}),
  };
}

export async function leerMaestra() {
  const sb = supabaseServidor();
  return {
    filas: construirMaestra(await datosMaestra()),
    hoja: await config(sb, 'maestra_hoja', { pestana: PESTANA_INICIAL }),
    sincronizada: await config(sb, 'maestra_sincronizada', null),
  };
}

/**
 * Guarda una corrección (valor null = volver al dato de Fleet).
 * @param destino { patente } para encargado y tipo; { conductorId } para nombre y RUT
 */
export async function guardarEdicion({ campo, valor, patente, conductorId, autor }) {
  const fila = CAMPOS_AUTO.includes(campo)
    ? { patente, conductor_id: null }
    : { patente: null, conductor_id: conductorId };
  const { error } = await supabaseServidor().from('maestra_ediciones')
    .insert({ ...fila, campo, valor, autor_email: autor });
  if (error) throw new Error('No se pudo guardar');
}

function sheets() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * Escribe la maestra en la hoja de Control Flota (columnas A a F de la
 * pestaña configurada; la crea si no existe). Lo que haya más a la derecha
 * no se toca.
 */
export async function sincronizarHoja() {
  const sb = supabaseServidor();
  const { pestana } = await config(sb, 'maestra_hoja', { pestana: PESTANA_INICIAL });
  const filas = filasHoja(construirMaestra(await datosMaestra()));
  const api = sheets();

  const meta = await api.spreadsheets.get({ spreadsheetId: HOJA_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === pestana)) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: HOJA_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: pestana } } }] },
    });
  }
  const rango = `'${pestana.replace(/'/g, "''")}'`;
  await api.spreadsheets.values.clear({ spreadsheetId: HOJA_ID, range: `${rango}!A:F` });
  await api.spreadsheets.values.update({
    spreadsheetId: HOJA_ID,
    range: `${rango}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: filas },
  });
  // Al lado de los títulos y no bajo la tabla: los scripts que leen esta hoja
  // (Copec, inDrive, el reporte) tomarían una fila extra abajo como conductor.
  const ahora = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '');
  await api.spreadsheets.values.update({
    spreadsheetId: HOJA_ID,
    range: `${rango}!H1:H2`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Última actualización (GoBills)'], [ahora]] },
  });

  const registro = { fecha: new Date().toISOString(), filas: filas.length - 1, pestana };
  await sb.from('configuracion').upsert({ clave: 'maestra_sincronizada', valor: registro });
  return registro;
}

/**
 * Compara la maestra con la pestaña original mientras GoBills todavía no la
 * reemplaza. Cuando la maestra ya escribe ahí, no hay nada que comparar.
 */
export async function compararConHojaOriginal() {
  const sb = supabaseServidor();
  const { pestana } = await config(sb, 'maestra_hoja', { pestana: PESTANA_INICIAL });
  if (pestana === PESTANA_ORIGINAL) return null;
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: HOJA_ID, range: `'${PESTANA_ORIGINAL}'` });
  const [cab = [], ...cuerpo] = res.data.values || [];
  const filas = cuerpo.map((r) => Object.fromEntries(cab.map((h, i) => [String(h).trim(), r[i] ?? ''])));
  return diferenciasConHoja(construirMaestra(await datosMaestra()), filas);
}
