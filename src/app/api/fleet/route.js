export const dynamic = 'force-dynamic'; // never cache — always fetch latest from Sheets

import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { supabaseServidor } from '@/lib/supabase/server';
import { estadoGarantia } from '@/lib/fleet/garantia';
import { rentaDeAuto, leerBalance } from '@/lib/fleet/renta';
import * as XLSX from 'xlsx';

const soloRut = (s) => String(s || '').toUpperCase().replace(/[^0-9K]/g, '');
const claveNombre = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/^(PPD|PDD|DTO)\s+/, '').replace(/\s+/g, ' ').trim();

/* Garantía pagada, activación y modalidad de cada conductor, desde la tabla
   conductores (la carga el export de conductores de Fleet). Si Supabase falla, la
   flota se sirve igual, sin la columna de garantía. */
async function fichasConductores() {
  try {
    const { data, error } = await supabaseServidor()
      .from('conductores')
      .select('rut, nombre, nombre_fleet, garantia_pagada, activacion, modalidad, baja');
    if (error) throw error;
    const porRut = new Map();
    const porNombre = new Map();
    const activos = [];
    for (const c of data || []) {
      if (c.baja) continue;
      activos.push(c);
      if (c.rut) porRut.set(soloRut(c.rut), c);
      for (const n of [c.nombre, c.nombre_fleet]) if (n) porNombre.set(claveNombre(n), c);
    }
    return { porRut, porNombre, activos };
  } catch (e) {
    console.error('[fleet] sin fichas de conductores:', e.message);
    return null;
  }
}

/* Balance de cada conductor (renta: 0 = al día, negativo = lo que debe) del
   último export de conductores aplicado en Carga de datos, y la marca de cada
   auto para saber su renta semanal. Si algo falla, la flota se sirve igual sin
   esos datos. */
async function rentasFleet() {
  try {
    const sb = supabaseServidor();
    const [{ data: carga, error }, { data: autos }] = await Promise.all([
      sb.from('cargas').select('archivo, ruta_storage, creado').eq('tipo', 'drivers').eq('aplicada', true)
        .order('creado', { ascending: false }).limit(1).maybeSingle(),
      sb.from('autos').select('patente, marca, modelo'),
    ]);
    if (error) throw error;
    const porRut = new Map();
    const porNombre = new Map();
    if (carga) {
      const { data: blob, error: e2 } = await sb.storage.from('cargas').download(carga.ruta_storage);
      if (e2) throw e2;
      const wb = XLSX.read(Buffer.from(await blob.arrayBuffer()), { type: 'buffer' });
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      for (const f of filas) {
        const balance = leerBalance(f['Balance']);
        if (balance == null) continue;
        if (soloRut(f['ID Number'])) porRut.set(soloRut(f['ID Number']), balance);
        if (f['Name']) porNombre.set(claveNombre(f['Name']), balance);
      }
    }
    const marcas = new Map((autos || []).map((a) => [String(a.patente).toUpperCase().replace(/[^A-Z0-9]/g, ''), a]));
    return { porRut, porNombre, al: carga?.creado || null, marcas };
  } catch (e) {
    console.error('[fleet] sin rentas:', e.message);
    return null;
  }
}

function hoyChile() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

const FLEET_SHEET_ID = '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw';
const FLEET_SHEET_NAME = 'Vehiculos y ConductoresII';
const TALLER_SHEET_NAME = 'VEHÍCULOS EN TALLER';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

export async function GET(request) {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // quotaUser nonce forces Google Sheets API to bypass its server-side response cache
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: FLEET_SHEET_ID,
      range: FLEET_SHEET_NAME,
      quotaUser: `gc-${Date.now()}`,
    });

    const rows = res.data.values || [];
    if (rows.length < 2) return NextResponse.json({ drivers: [] });

    // Las tres primeras columnas (Name, Vehicles, Created At) son estables; la del
    // coordinador se ha movido de sitio y ha perdido su encabezado, así que se busca
    // en vez de leerse por posición fija: primero por nombre de encabezado y, si no
    // aparece, la última columna que venga llena en la mayoría de las filas.
    const header = (rows[0] || []).map((h) => String(h || '').toLowerCase().trim());
    const body = rows.slice(1).filter((r) => r[0]);
    let iCoord = header.findIndex(
      (h) => h.includes('coordinator') || h.includes('coordinador') || h.includes('encargado')
    );
    if (iCoord < 0) {
      // Respaldo por si vuelven a renombrarla: la última columna con datos, pero
      // saltando las que sabemos que son otra cosa. Sin esta exclusión, agregar
      // "Rut" y "Tipo" hacía que el filtro de coordinador mostrara DTO y Renta.
      const esOtraCosa = (h) => /rut|tipo|modalidad|patente|veh|fecha|creat|nota|mail|correo|telefono|fono/.test(h);
      for (let c = header.length - 1; c >= 3; c--) {
        if (esOtraCosa(header[c])) continue;
        const llenas = body.filter((r) => String(r[c] || '').trim()).length;
        if (body.length && llenas / body.length > 0.5) { iCoord = c; break; }
      }
    }
    // Modalidad del vehículo: DTO (drive to own) o renta
    const iTipo = header.findIndex((h) => h === 'tipo' || h.includes('modalidad'));

    // Por encabezado y no por posición: cuando la hoja ganó la columna "Rut" en la
    // C, el campo fechaInicio (que se leía de la C) pasó a llevar el RUT de cada
    // conductor y la API lo devolvía. El RUT se usa solo acá adentro, para cruzar
    // con la ficha del conductor, y nunca sale en la respuesta.
    const iRut = header.findIndex((h) => h === 'rut' || h.includes('rut'));
    const iCreado = header.findIndex((h) => h.includes('created') || h.includes('fecha'));
    const iNota = header.findIndex((h) => h.includes('nota'));
    const [fichas, rentas] = await Promise.all([fichasConductores(), rentasFleet()]);
    const hoy = hoyChile();

    const drivers = body.map((r) => {
      const conductor = String(r[0] || '').trim().toUpperCase();
      const rut = iRut >= 0 ? soloRut(r[iRut]) : '';
      const ficha = fichas
        ? (rut && fichas.porRut.get(rut)) || fichas.porNombre.get(claveNombre(conductor)) || null
        : null;
      return {
        conductor,
        patente: String(r[1] || '').trim(),
        fechaInicio: iCreado >= 0 ? String(r[iCreado] || '').trim() : '',
        nota: iNota >= 0 ? String(r[iNota] || '').trim() : '',
        coordinador: iCoord >= 0 ? String(r[iCoord] || '').trim() : '',
        tipo: iTipo >= 0 ? String(r[iTipo] || '').trim() : '',
        garantia: ficha
          ? estadoGarantia({ garantia: ficha.garantia_pagada, activacion: ficha.activacion, modalidad: ficha.modalidad }, hoy)
          : null,
        garantiaPagada: ficha ? ficha.garantia_pagada ?? null : null,
        renta: rentas ? (() => {
          const pat = String(r[1] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const auto = rentas.marcas.get(pat);
          const tarifa = auto ? rentaDeAuto(auto.marca, auto.modelo) : null;
          const balance = (rut ? rentas.porRut.get(rut) : undefined) ?? rentas.porNombre.get(claveNombre(conductor)) ?? null;
          return { semanal: tarifa?.monto ?? null, modelo: tarifa?.modelo ?? null, balance, balanceAl: rentas.al };
        })() : null,
      };
    });

    // Un auto sin conductor (en taller, esperando entrega) sigue en la hoja con su
    // patente y su encargado, solo que sin nombre. `drivers` lo descarta porque es
    // la lista de conductores; `vehiculos` lo mantiene, que es lo que permite saber
    // de qué coordinador es un auto aunque nadie lo esté manejando.
    const vehiculos = rows.slice(1)
      .filter((r) => String(r[1] || '').trim())
      .map((r) => ({
        patente: String(r[1] || '').trim().toUpperCase().replace(/[-\s]/g, ''),
        conductor: String(r[0] || '').trim().toUpperCase(),
        coordinador: iCoord >= 0 ? String(r[iCoord] || '').trim() : '',
        tipo: iTipo >= 0 ? String(r[iTipo] || '').trim() : '',
      }));

    // ── Vehículos en taller ───────────────────────────────────────────────────
    // Hoja aparte de la misma planilla. Si falla o no existe, el resto del
    // endpoint sigue sirviendo: la flota no depende de esto.
    let taller = [];
    try {
      const tRes = await sheets.spreadsheets.values.get({
        spreadsheetId: FLEET_SHEET_ID,
        range: TALLER_SHEET_NAME,
        quotaUser: `gc-${Date.now()}`,
      });
      const tRows = tRes.data.values || [];
      // Por nombre de columna y no por posición: esta hoja ya gano una columna
      // (MODELO-MARCA en la C) y leerla por indice fijo corrio todos los campos
      // una casilla, haciendo que la fecha de ingreso se leyera como egreso.
      const th = (tRows[0] || []).map((h) =>
        String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
      );
      const tcol = (...claves) => {
        for (const k of claves) {
          const i = th.findIndex((h) => h.includes(k));
          if (i !== -1) return i;
        }
        return -1;
      };
      const cPat = tcol('patente', 'plate');
      const cEst = tcol('estado');
      const cMod = tcol('modelo', 'marca');
      const cIng = tcol('ingreso');
      const cEgr = tcol('egreso', 'salida');
      const cTal = tcol('taller');
      const cObs = tcol('observ');
      const cCon = tcol('conductor');
      const val = (r, i) => (i >= 0 ? String(r[i] || '').trim() : '');

      taller = tRows.slice(1)
        .filter((r) => val(r, cPat))
        .map((r) => ({
          patente: val(r, cPat).toUpperCase().replace(/[-\s]/g, ''),
          estado: val(r, cEst),
          modelo: val(r, cMod),
          ingreso: val(r, cIng),
          // "SIN FECHA" es el marcador que usa la planilla cuando el taller
          // todavía no compromete una salida: se normaliza a vacío para que el
          // reporte no tenga que conocer esa convención.
          egreso: /sin\s*fecha/i.test(val(r, cEgr)) ? '' : val(r, cEgr),
          taller: val(r, cTal),
          observaciones: val(r, cObs),
          ultimoConductor: val(r, cCon),
        }));
    } catch (e) {
      taller = [];
    }

    const noCache = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };
    // La garantía de todos los conductores de Fleet por nombre (sin RUT), para los
    // que salen en el reporte pero no están en Control Flota
    const garantias = (fichas?.activos || []).map((c) => ({
      nombres: [...new Set([c.nombre, c.nombre_fleet].filter(Boolean).map((n) => String(n).toUpperCase()))],
      garantia: estadoGarantia({ garantia: c.garantia_pagada, activacion: c.activacion, modalidad: c.modalidad }, hoy),
    }));

    return NextResponse.json({ drivers, vehiculos, taller, garantias, _fetchedAt: new Date().toISOString() }, { headers: noCache });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
