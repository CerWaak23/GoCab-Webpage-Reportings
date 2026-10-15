export const dynamic = 'force-dynamic'; // never cache — always fetch latest from Drive

import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { leerFilas } from '@/lib/bills/archivo';
import { multasDeFilas, reporteMultas } from '@/lib/multas/reporte';
import { supabaseServidor } from '@/lib/supabase/server';

const FINES_FOLDER_ID = '1O5GblTXWQI_6RBn7072am1nprtZYcvJ7';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Missing Google credentials: set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY');
  }
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

/** Igual que en bills: el costo es el ida y vuelta con Drive, no el tamaño. */
async function descargarEnParalelo(drive, files, limite = 10) {
  const buffers = new Array(files.length);
  let siguiente = 0;
  const bajarUno = async (i) => {
    for (let intento = 0; intento < 2; intento++) {
      try {
        const res = await drive.files.get(
          { fileId: files[i].id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        return Buffer.from(res.data);
      } catch (err) {
        if (intento === 1) throw new Error(`No se pudo leer "${files[i].name}": ${err.message}`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  };
  const worker = async () => {
    while (true) {
      const i = siguiente++;
      if (i >= files.length) return;
      buffers[i] = await bajarUno(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, files.length) }, worker));
  return buffers;
}

const SIN_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };

/**
 * Reporte de multas. Desde oct-2026 lee la historia guardada en Supabase (los
 * exports se suben en Carga de datos). Con ?fuente=drive, o si Supabase falla,
 * lee la carpeta de Drive como antes: queda de respaldo.
 */
export async function GET(request) {
  // Mientras se termina de importar la historia, Supabase solo con ?fuente=supabase.
  if (new URL(request.url).searchParams.get('fuente') === 'supabase') {
    try {
      return NextResponse.json({ ...(await reporteDesdeSupabase()), fuente: 'supabase', _fetchedAt: new Date().toISOString() }, { headers: SIN_CACHE });
    } catch (err) {
      console.error('multas: Supabase falló, se usa Drive', err.message);
    }
  }
  return desdeDrive();
}

async function reporteDesdeSupabase() {
  const sb = supabaseServidor();
  const todas = async (tabla, columnas) => {
    const out = [];
    for (let desde = 0; ; desde += 1000) {
      // Por archivo y, dentro de cada uno, en el orden de las filas del export.
      const { data, error } = await sb.from(tabla).select(columnas)
        .order('subido').order(tabla.endsWith('_versiones') ? 'archivo_id' : 'id')
        .order(tabla.endsWith('_versiones') ? 'orden' : 'id').order('id')
        .range(desde, desde + 999);
      if (error) throw new Error(error.message);
      out.push(...data);
      if (data.length < 1000) return out;
    }
  };
  const [archivos, versiones] = await Promise.all([
    todas('multas_archivos', 'id, archivo, subido, formato_desconocido, encabezado'),
    todas('multas_versiones', 'id, archivo_id, clave, base, referencia, fecha_contravencion, cargo, pago, estado, conductor, vehiculo, creado, descripcion'),
  ]);
  if (archivos.length === 0) throw new Error('Supabase no tiene exports de multas');
  const porArchivo = new Map();
  for (const v of versiones) {
    if (!porArchivo.has(v.archivo_id)) porArchivo.set(v.archivo_id, []);
    porArchivo.get(v.archivo_id).push({
      clave: v.clave, base: v.base, ref: v.referencia, fechaContravencion: v.fecha_contravencion || '',
      cargo: Number(v.cargo), pago: Number(v.pago), estado: v.estado || '', conductor: v.conductor || '',
      vehiculo: v.vehiculo || '', creado: v.creado || '', descripcion: v.descripcion || '',
    });
  }
  return reporteMultas(archivos.map((a) => ({
    name: a.archivo,
    modifiedTime: new Date(a.subido).toISOString(),
    formatoDesconocido: a.formato_desconocido,
    encabezado: a.encabezado || [],
    filas: porArchivo.get(a.id) || [],
  })));
}

async function desdeDrive() {
  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Oldest→newest: cada archivo pisa al anterior, y la transición de estado
    // entre versiones es la que delata el pago.
    const listRes = await drive.files.list({
      q: `'${FINES_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime),nextPageToken',
      orderBy: 'modifiedTime asc',
      pageSize: 1000,
      quotaUser: `gc-${Date.now()}`,
    });
    const files = listRes.data.files || [];

    const tabulares = files.filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv');
    });

    const buffers = await descargarEnParalelo(drive, tabulares);
    const archivos = tabulares.map((file, idx) => ({
      name: file.name,
      modifiedTime: file.modifiedTime,
      ...multasDeFilas(leerFilas(buffers[idx], file.name, { html: false })),
    }));

    return NextResponse.json(
      {
        ...reporteMultas(archivos),
        fuente: 'drive',
        _fetchedAt: new Date().toISOString(),
      },
      { headers: SIN_CACHE }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
