// Script para inspeccionar los archivos de pórticos en Google Drive
// Corre con: node scripts/inspect-tolls.mjs

import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// Manually load .env.local
try {
  const envPath = path.join(process.cwd(), '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[k] = v;
  }
} catch(e) { console.warn('No .env.local found'); }

const TOLLS_FOLDER_ID = '1rn3x_-ixgPqwvUzx6Tkqb0Pzjd6LT-xw';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing credentials in .env.local');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function parseValor(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') {
    if (Number.isInteger(val) && val > 1000) return val / 100; // centavos
    return val;
  }
  const s = String(val).trim().replace(/\$/g, '').replace(/\.(?=\d{3}(?:[,\s]|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

async function main() {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const listRes = await drive.files.list({
    q: `'${TOLLS_FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'modifiedTime asc',
  });

  const files = listRes.data.files || [];
  console.log(`\n=== ${files.length} archivos en carpeta pórticos ===\n`);

  for (const file of files) {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.csv')) continue;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📄 ${file.name}`);
    console.log(`   ID: ${file.id}  |  Modificado: ${file.modifiedTime}`);

    let fileRes;
    try {
      fileRes = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
    } catch (e) {
      console.log(`   ❌ Error al descargar: ${e.message}`);
      continue;
    }

    const buffer = Buffer.from(fileRes.data);
    let rows;
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      console.log(`   Hojas: ${wb.SheetNames.join(', ')}`);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    } catch (e) {
      console.log(`   ❌ Error al parsear: ${e.message}`);
      continue;
    }

    console.log(`   Total filas (incluyendo encabezado): ${rows.length}`);

    // Find header row
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const joined = rows[i].map(c => String(c).toLowerCase()).join('|');
      if (joined.includes('patente') || joined.includes('movil') || joined.includes('móvil')) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      console.log('   ⚠️  No se encontró fila de encabezado. Primeras 3 filas:');
      rows.slice(0, 3).forEach((r, i) => console.log(`     Fila ${i}: ${r.slice(0,10).join(' | ')}`));
      continue;
    }

    const header = rows[headerIdx].map(h => String(h).trim());
    console.log(`\n   ✅ Encabezado en fila ${headerIdx}:`);
    header.forEach((h, i) => {
      if (h) console.log(`      Col ${i}: "${h}"`);
    });

    // Show first 5 data rows
    console.log(`\n   Primeras 5 filas de datos:`);
    const dataRows = rows.slice(headerIdx + 1, headerIdx + 6);
    dataRows.forEach((row, ri) => {
      const cells = header.map((h, i) => `${h}: ${JSON.stringify(row[i])}`).filter((_, i) => header[i]);
      console.log(`   Fila ${ri + 1}: ${cells.join(' | ')}`);
    });

    // Column detection using same logic as route.js
    const ci = (names) => {
      for (const n of names) {
        const idx = header.findIndex(h => h.toLowerCase().includes(n));
        if (idx !== -1) return idx;
      }
      return -1;
    };
    const iP = ci(['patente', 'móvil', 'movil', 'placa']);
    const iV = ci(['valor', 'monto', 'importe', 'cobro']);
    const iF = ci(['fecha inicial', 'fecha inicio', 'fecha_entrada', 'fecha']);
    // Prefer exact 'autopista' column over 'tipo_autopista' (new format has both)
    const exactA = header.findIndex(h => h.toLowerCase() === 'autopista');
    const iA = exactA !== -1 ? exactA : ci(['autopista', 'ruta', 'vía', 'via']);
    const iPor = ci(['pórtico', 'portico', 'rtico', 'portal', 'plaza de cobro', 'plaza', 'peaje']);
    const iT = ci(['tipo tarifa', 'tipo de tarifa', 'tarifa', 'categoría', 'categoria', 'clase']);
    // Old format ('valor' column) = centavos; new format ('valor_cobro') = direct pesos
    const valorInCentavos = iV >= 0 && header[iV].toLowerCase() === 'valor';

    console.log(`\n   🔍 Detección de columnas (API logic):`);
    console.log(`      iPatente=${iP} (${header[iP]||'—'})  iValor=${iV} (${header[iV]||'—'})`);
    console.log(`      iFecha=${iF} (${header[iF]||'—'})  iAutopista=${iA} (${header[iA]||'—'})`);
    console.log(`      iPortico=${iPor} (${header[iPor]||'—'})  iTipoTarifa=${iT} (${header[iT]||'—'})`);

    // Simulate API logic: build fileAccum and transactions
    const fileAccum = {};
    const txnSet = new Set();
    const transactions = [];
    let blankPlate = 0, skippedValor = 0, skippedDate = 0;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const rawPlate = String(row[iP] || '').trim();
      if (!rawPlate) { blankPlate++; continue; }
      const plate = rawPlate.toUpperCase().replace(/[-\s]/g, '');
      if (!plate) continue;

      const rawValor = row[iV];
      const valor = typeof rawValor === 'number' && Number.isInteger(rawValor) && rawValor > 0
        ? (valorInCentavos ? rawValor / 100 : rawValor)
        : parseValor(rawValor);
      if (valor <= 0) { skippedValor++; continue; }

      // Parse date — same logic as parseFecha() in route.js
      const rawF = row[iF];
      let wk = null;
      const num2 = typeof rawF === 'number' ? rawF : parseFloat(String(rawF));
      // Weeks run Friday 00:00 → Thursday 23:59 (epoch = Friday 3 Jan 2020)
      const _mn = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const _ep = new Date('2020-01-03');
      const _ms = 7 * 24 * 60 * 60 * 1000;
      function _wkLabel(d){ const wn=Math.floor((d-_ep)/_ms); const ws=new Date(_ep.getTime()+wn*_ms); const we=new Date(ws.getTime()+6*24*60*60*1000); const sd=ws.getUTCDate(),sm=_mn[ws.getUTCMonth()],ed=we.getUTCDate(),em=_mn[we.getUTCMonth()]; return sm===em?`${sd}-${ed} ${sm}`:`${sd} ${sm}-${ed} ${em}`; }
      if (!isNaN(num2) && num2 > 40000 && num2 < 60000) {
        const d = new Date((num2 - 25569) * 86400 * 1000);
        wk = _wkLabel(d);
      } else {
        // ISO string: YYYY-MM-DD HH:MM:SS or dd/mm/yyyy
        const str = String(rawF || '').trim();
        const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2})?)?/);
        const dmy = !iso && str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/);
        let d = null;
        if (iso) d = new Date(+iso[1], +iso[2]-1, +iso[3], +(iso[4]||0), +(iso[5]||0));
        else if (dmy) d = new Date(+dmy[3], +dmy[2]-1, +dmy[1], +(dmy[4]||0), +(dmy[5]||0));
        if (d && !isNaN(d)) wk = _wkLabel(d);
      }
      if (!wk) { skippedDate++; continue; }

      if (!fileAccum[plate]) fileAccum[plate] = {};
      fileAccum[plate][wk] = (fileAccum[plate][wk] || 0) + valor;

      const autopista = iA >= 0 ? String(row[iA] || '').trim() : '';
      const portico = iPor >= 0 ? String(row[iPor] || '').trim() : '';
      const txnKey = `${plate}|${String(rawF)}|${autopista}|${portico}|${valor}`;
      if (!txnSet.has(txnKey)) {
        txnSet.add(txnKey);
        transactions.push({ plate, wk, valor, portico, autopista });
      }
    }

    // Compare pivot total vs transaction sum
    const pivotTotal = Object.values(fileAccum).reduce((s, wkMap) =>
      s + Object.values(wkMap).reduce((a, v) => a + v, 0), 0);
    const txnTotal = transactions.reduce((s, t) => s + t.valor, 0);
    const dedupedRows = txnSet.size;
    const porticoFilled = transactions.filter(t => t.portico).length;

    console.log(`\n   📊 Resumen:`);
    console.log(`      Filas sin patente: ${blankPlate} | Sin valor válido: ${skippedValor} | Sin fecha: ${skippedDate}`);
    console.log(`      Transacciones únicas (txnSet): ${dedupedRows}`);
    console.log(`      Pórtico con dato: ${porticoFilled}/${dedupedRows} (${Math.round(porticoFilled/dedupedRows*100)}%)`);
    console.log(`      Total PIVOT (fileAccum sum):   $${pivotTotal.toLocaleString('es-CL',{minimumFractionDigits:2})} CLP`);
    console.log(`      Total DETALLE (txn sum):       $${txnTotal.toLocaleString('es-CL',{minimumFractionDigits:2})} CLP`);
    if (Math.abs(pivotTotal - txnTotal) > 1) {
      console.log(`      ⚠️  DIFERENCIA: $${Math.abs(pivotTotal - txnTotal).toLocaleString('es-CL',{minimumFractionDigits:2})} CLP`);
    } else {
      console.log(`      ✅ Pivot = Detalle (diferencia < $1)`);
    }

    // Show sample pórtico values
    const porticoSamples = [...new Set(transactions.filter(t=>t.portico).map(t=>t.portico))].slice(0,5);
    if (porticoSamples.length) {
      console.log(`\n   🛣️  Muestras de pórtico:`);
      porticoSamples.forEach(p => console.log(`      "${p}"`));
    }
  }

  console.log(`\n${'═'.repeat(70)}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
