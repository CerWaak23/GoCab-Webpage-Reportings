export const dynamic = 'force-dynamic'; // never cache HTTP response — always check Drive

import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const TOLLS_FOLDER_ID = '1rn3x_-ixgPqwvUzx6Tkqb0Pzjd6LT-xw';

// ── Disk cache ─────────────────────────────────────────────────────────────────
// Persists processed data across server restarts.  Only a lightweight Drive
// metadata list is needed to decide whether the disk cache is still valid.
const CACHE_DIR  = join(process.cwd(), '.cache');
const CACHE_FILE = join(CACHE_DIR, 'tolls-cache.json');

// ── In-memory cache ────────────────────────────────────────────────────────────
// Key = joined "fileId:modifiedTime" for all files in the folder.
// Populated either by a fresh Drive download OR by loading from disk.
let _cacheKey    = '';
let _cacheData   = null;
let _diskLoaded  = false;  // true once we've attempted the disk-load (one-shot)

function loadDiskCache() {
  if (_diskLoaded) return;
  _diskLoaded = true;
  try {
    const raw    = readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.key && parsed.data) {
      _cacheKey  = parsed.key;
      _cacheData = parsed.data;
      console.log('[tolls] Loaded cache from disk');
    }
  } catch {
    // File doesn't exist yet or is malformed — ignore, will build fresh
  }
}

function saveDiskCache(key, data) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ key, data }), 'utf-8');
    console.log('[tolls] Cache saved to disk');
  } catch (e) {
    console.warn('[tolls] Could not save cache to disk:', e.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing Google credentials');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function parseValor(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  const cleaned = s
    .replace(/\$/g, '')
    .replace(/\.(?=\d{3}(?:[,\s]|$))/g, '')
    .replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseFecha(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  const num = typeof s === 'number' ? s : parseFloat(String(s));
  if (!isNaN(num) && num > 40000 && num < 60000) {
    return new Date((num - 25569) * 86400 * 1000);
  }
  const str = String(s).trim();
  const m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
}

function getWeekKey(d) {
  if (!d || isNaN(d)) return null;
  const epoch = new Date('2020-01-06');
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const wn = Math.floor((d - epoch) / msPerWeek);
  const weekStart = new Date(epoch.getTime() + wn * msPerWeek);
  const mn = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${weekStart.getUTCDate()} ${mn[weekStart.getUTCMonth()]}`;
}

function normPlate(s) {
  return String(s || '').toUpperCase().replace(/[-\s]/g, '').trim();
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[tolls] Hard timeout after ${ms} ms`);
      resolve(fallback);
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); console.warn('[tolls] fetchTolls error:', e.message); resolve(fallback); }
    );
  });
}

// ── Process one file buffer into rows ──────────────────────────────────────────

function parseBuffer(name, buffer) {
  if (name.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/);
    const delim = lines[0]?.includes(';') ? ';' : ',';
    return lines.map(l => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim()));
  }
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

// ── Main fetch ─────────────────────────────────────────────────────────────────

async function fetchTolls() {
  // Try loading the disk cache on first call after a (re)start
  loadDiskCache();

  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  // 1. List files (lightweight metadata only — no file content downloaded)
  const listRes = await drive.files.list({
    q: `'${TOLLS_FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'modifiedTime asc',
  });
  const files = (listRes.data.files || []).filter(f => {
    const n = f.name.toLowerCase();
    return n.endsWith('.xls') || n.endsWith('.xlsx') || n.endsWith('.csv');
  });

  // 2. Build cache key from file IDs + modifiedTimes
  //    If nothing changed since last load (memory or disk), return immediately.
  const newKey = files.map(f => `${f.id}:${f.modifiedTime}`).join('|');
  if (newKey && newKey === _cacheKey && _cacheData) {
    console.log('[tolls] Cache hit — returning cached result (no Drive downloads)');
    return _cacheData;
  }

  // 3. Something changed (or first ever run) → download ALL files in parallel
  console.log(`[tolls] Downloading ${files.length} file(s) in parallel…`);
  const t0 = Date.now();

  const downloads = await Promise.all(
    files.map(async (file) => {
      try {
        const res = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        return { file, buffer: Buffer.from(res.data) };
      } catch (e) {
        console.warn(`[tolls] Skipping ${file.name}: ${e.message}`);
        return { file, buffer: null };
      }
    })
  );

  console.log(`[tolls] All downloads done in ${Date.now() - t0} ms`);

  // 4. Parse & aggregate
  const byPatente  = {};
  const weekDates  = {};
  const txnSet     = new Set();
  const transactions = [];
  const fileHeaders  = [];

  // String dictionaries — store each unique autopista/portico/tipoTarifa once
  // and use its index in every transaction object.  Reduces JSON payload from
  // ~12 MB to ~2-3 MB because long pórtico strings repeat constantly.
  const autopistaDict  = [];  // index → string
  const autopistaIdx   = {};  // string → index
  const porticoDict    = [];
  const porticoIdx     = {};
  const tipoTarifaDict = [];
  const tipoTarifaIdx  = {};
  const intern = (dict, map, val) => {
    if (!(val in map)) { map[val] = dict.length; dict.push(val); }
    return map[val];
  };

  for (const { file, buffer } of downloads) {
    if (!buffer) continue;

    let rows;
    try { rows = parseBuffer(file.name.toLowerCase(), buffer); }
    catch (e) { console.warn(`[tolls] Parse error ${file.name}: ${e.message}`); continue; }

    // Find header row (first row containing "patente" or "movil")
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const joined = rows[i].map(c => String(c).toLowerCase()).join('|');
      if (joined.includes('patente') || joined.includes('movil') || joined.includes('móvil')) {
        headerIdx = i; break;
      }
    }
    if (headerIdx === -1) continue;

    const header = rows[headerIdx].map(h => String(h).toLowerCase().trim());

    const ci = (names) => {
      for (const n of names) {
        const idx = header.findIndex(h => h.includes(n));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const iPatente    = ci(['patente', 'móvil', 'movil', 'placa']);
    const iValor      = ci(['valor', 'monto', 'importe', 'cobro']);
    const iFecha      = ci(['fecha inicial', 'fecha inicio', 'fecha']);
    const iAutopista  = ci(['autopista', 'ruta', 'vía', 'via']);
    // 'rtico' matches "P?rtico" (Windows-1252 XLS decoded by XLSX.js → U+FFFD char)
    const iPortico    = ci(['pórtico', 'portico', 'rtico', 'portal', 'plaza de cobro', 'plaza', 'peaje', 'estación', 'estacion', 'cabina']);
    const iTipoTarifa = ci(['tipo tarifa', 'tipo de tarifa', 'tarifa', 'categoría', 'categoria', 'clase', 'tipo de veh']);

    fileHeaders.push({ file: file.name, iPatente, iValor, iFecha, iAutopista, iPortico, iTipoTarifa });
    if (iPatente === -1 || iValor === -1 || iFecha === -1) continue;

    const fileAccum   = {};
    const fileRawPlate = {};

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const rawPlate = String(row[iPatente] || '').trim();
      if (!rawPlate) continue;
      const plate = normPlate(rawPlate);
      if (!plate) continue;

      const rawValor = row[iValor];
      // Chilean toll files store amounts as integer centavos (28579 = $285.79 CLP)
      const valor = typeof rawValor === 'number' && Number.isInteger(rawValor) && rawValor > 0
        ? rawValor / 100
        : parseValor(rawValor);
      if (valor <= 0) continue;

      const fecha = parseFecha(row[iFecha]);
      const wk    = fecha ? getWeekKey(fecha) : null;
      if (!wk) continue;

      if (!fileAccum[plate]) { fileAccum[plate] = {}; fileRawPlate[plate] = rawPlate; }
      fileAccum[plate][wk] = (fileAccum[plate][wk] || 0) + valor;

      if (!weekDates[wk]) weekDates[wk] = fecha;
      else if (fecha < weekDates[wk]) weekDates[wk] = fecha;

      // Dedup key: full date serial (includes fractional hours) + pórtico → unique per pass
      const rawFechaStr = String(row[iFecha]);
      const autopista   = iAutopista  >= 0 ? String(row[iAutopista]  || '').trim() : '';
      const portico     = iPortico    >= 0 ? String(row[iPortico]    || '').trim() : '';
      const tipoTarifa  = iTipoTarifa >= 0 ? String(row[iTipoTarifa] || '').trim() : '';
      const txnKey = `${plate}|${rawFechaStr}|${autopista}|${portico}|${valor}`;

      if (!txnSet.has(txnKey)) {
        txnSet.add(txnKey);
        const fechaStr = fecha
          ? `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth()+1).padStart(2,'0')}-${String(fecha.getUTCDate()).padStart(2,'0')}`
          : null;
        // Store indices instead of full strings → 5-8x smaller JSON payload
        transactions.push({
          plate, wk, fechaStr, valor,
          ai: intern(autopistaDict,  autopistaIdx,  autopista),
          pi: intern(porticoDict,    porticoIdx,    portico),
          ti: intern(tipoTarifaDict, tipoTarifaIdx, tipoTarifa),
        });
      }
    }

    // Merge into global byPatente (max handles cumulative exports if they ever appear)
    for (const [plate, wkMap] of Object.entries(fileAccum)) {
      if (!byPatente[plate]) byPatente[plate] = { _rawPlate: fileRawPlate[plate] };
      for (const [wk, val] of Object.entries(wkMap)) {
        byPatente[plate][wk] = Math.max(byPatente[plate][wk] || 0, val);
      }
    }
  }

  const allWeeks = Object.keys(weekDates).sort((a, b) => weekDates[a] - weekDates[b]);

  const totalByPatente = {};
  for (const [plate, data] of Object.entries(byPatente)) {
    totalByPatente[plate] = allWeeks.reduce((s, wk) => s + (data[wk] || 0), 0);
  }

  const result = {
    byPatente, allWeeks, totalByPatente,
    transactions, fileHeaders,
    autopistas: autopistaDict,   // lookup arrays for transaction indices
    porticos:   porticoDict,
    tipoTarifas: tipoTarifaDict,
    sources: files.map(f => f.name),
  };

  // 5. Update in-memory cache and persist to disk so restarts stay fast
  _cacheKey  = newKey;
  _cacheData = result;
  console.log(`[tolls] Processed ${transactions.length} transactions in ${Date.now() - t0} ms — cache updated`);

  // Save to disk asynchronously (don't block the response)
  setImmediate(() => saveDiskCache(newKey, result));

  return result;
}

const EMPTY_TOLLS = { byPatente: {}, allWeeks: [], totalByPatente: {}, transactions: [], fileHeaders: [], autopistas: [], porticos: [], tipoTarifas: [], sources: [] };

export async function GET(request) {
  try {
    const data = await withTimeout(fetchTolls(), 55000, EMPTY_TOLLS);

    // ?plate=XXXX  →  return only that plate's transactions + lookup arrays
    // Used by the detail panel when a conductor is clicked (lazy load).
    const plate = request.nextUrl?.searchParams?.get('plate');
    if (plate) {
      const p = normPlate(plate);
      const txns = data.transactions.filter(t => t.plate === p);
      return NextResponse.json({
        transactions: txns,
        autopistas:   data.autopistas,
        porticos:     data.porticos,
        tipoTarifas:  data.tipoTarifas,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Default  →  pivot data only; NO transactions sent to browser.
    // Transactions are fetched on demand (see ?plate= above) so the
    // initial page load stays small and doesn't crash low-RAM machines.
    return NextResponse.json({
      byPatente:      data.byPatente,
      allWeeks:       data.allWeeks,
      totalByPatente: data.totalByPatente,
      sources:        data.sources,
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
