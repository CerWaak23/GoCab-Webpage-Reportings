/**
 * Lectura de la planilla de flota, incluido el RUT.
 *
 * /api/fleet expone la flota al dashboard pero deja el RUT fuera a propósito.
 * Acá se lee la columna completa porque el portal de conductores la necesita
 * para autenticar — y por eso este módulo es solo de servidor: el RUT nunca
 * viaja al navegador, solo se compara contra lo que escribió el conductor.
 */

import { google } from 'googleapis';

const FLEET_SHEET_ID = '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw';
const FLEET_SHEET_NAME = 'Vehiculos y ConductoresII';

// Memo corto: sin esto, cada intento de login gasta una llamada a Sheets.
const MEMO_MS = 5 * 60 * 1000;
let _memo = null; // { at, filas }

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

export function normalizarPatente(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * "21.000.176-K" → "21000176K". Acepta que lo escriban con puntos, sin puntos,
 * con guion o sin él, que es como lo va a tipear cualquiera en un celular.
 */
export function normalizarRut(s) {
  return String(s || '').toUpperCase().replace(/[^0-9K]/g, '');
}

async function leerFlota() {
  if (_memo && Date.now() - _memo.at < MEMO_MS) return _memo.filas;

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: FLEET_SHEET_ID,
    range: FLEET_SHEET_NAME,
  });

  const filas = res.data.values || [];
  if (filas.length < 2) return [];

  // Por nombre de encabezado y no por posición: esta planilla ya movió columnas
  // antes (el coordinador cambió de lugar y perdió su título).
  const cab = filas[0].map((h) => String(h || '').toLowerCase().trim());
  const col = (...claves) => {
    for (const k of claves) {
      const i = cab.findIndex((h) => h.includes(k));
      if (i !== -1) return i;
    }
    return -1;
  };

  const iNombre = col('name', 'nombre', 'conductor');
  const iPatente = col('vehicle', 'patente', 'placa');
  const iRut = col('rut');

  if (iNombre < 0 || iPatente < 0 || iRut < 0) {
    throw new Error('La planilla de flota no tiene las columnas Name, Vehicles y Rut');
  }

  const datos = filas.slice(1)
    .filter((f) => f[iNombre] && f[iPatente] && f[iRut])
    .map((f) => ({
      nombre: String(f[iNombre]).trim(),
      patente: normalizarPatente(f[iPatente]),
      rut: normalizarRut(f[iRut]),
    }));

  _memo = { at: Date.now(), filas: datos };
  return datos;
}

/**
 * Devuelve { nombre, patente } si la patente y el RUT corresponden a la misma
 * fila de la planilla. null en cualquier otro caso.
 */
export async function buscarConductor(patenteEscrita, rutEscrito) {
  const patente = normalizarPatente(patenteEscrita);
  const rut = normalizarRut(rutEscrito);
  if (!patente || !rut) return null;

  const flota = await leerFlota();
  const fila = flota.find((f) => f.patente === patente && f.rut === rut);
  if (!fila) return null;

  return { nombre: fila.nombre, patente: fila.patente };
}

/**
 * Primer nombre en formato presentable: la planilla los guarda en mayúsculas y
 * a veces con prefijos de estado ("PPD ANDRÉS TORRES").
 */
export function nombreDePila(nombreCompleto) {
  const partes = String(nombreCompleto || '')
    .trim()
    .split(/\s+/)
    .filter((p) => !/^(PPD|PDD|PD)$/i.test(p));
  const primero = partes[0] || 'conductor';
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
}
