// Script para inspeccionar los archivos de SumUp en Google Drive
// Corre con: node scripts/inspect-sumup.mjs

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

const SUMUP_FOLDER_ID = '1IR7ETMtvoi-LF4AXbfalbO2th_b_ImNi';

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing credentials in .env.local');
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function parseCSV(buffer) {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes(';') ? ';' : ',';
  return lines.map(line => {
    const result = [];
    let inQ = false, field = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === delim && !inQ) { result.push(field.trim()); field = ''; }
      else { field += ch; }
    }
    result.push(field.trim());
    return result;
  });
}

async function main() {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const listRes = await drive.files.list({
    q: `'${SUMUP_FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'modifiedTime asc',
  });

  const files = listRes.data.files || [];
  console.log(`\n=== ${files.length} archivos en carpeta SumUp ===\n`);

  let grandTotal = { bruto: 0, comision: 0, neto: 0, txn: 0, retiros: 0 };

  for (const file of files) {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.xls')) continue;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📄 ${file.name}`);

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
      if (name.endsWith('.csv')) {
        rows = parseCSV(buffer);
      } else {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        console.log(`   Hojas: ${wb.SheetNames.join(', ')}`);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      }
    } catch (e) {
      console.log(`   ❌ Error al parsear: ${e.message}`);
      continue;
    }

    if (rows.length < 2) { console.log('   ⚠️  Menos de 2 filas'); continue; }

    const header = rows[0].map(h => String(h || '').toLowerCase().trim().replace(/\s+/g, ' '));
    console.log(`\n   Encabezados: ${header.filter(h=>h).map((h,i)=>`[${i}]${h}`).join(' | ')}`);

    const col = (names) => {
      for (const n of names) {
        const i = header.findIndex(h => h.includes(n));
        if (i !== -1) return i;
      }
      return -1;
    };

    const iType  = col(['tipo de transacción', 'transaction type', 'tipo']);
    const iState = col(['estado', 'status']);
    const iGross = col(['monto de la transacción', 'monto bruto', 'gross amount', 'bruto', 'importe bruto', 'total price', 'precio total', 'amount']);
    const iFee   = col(['monto de la comisión', 'comisión total', 'total commission', 'comisión', 'comision', 'commission', 'fee']);
    const iNet   = col(['monto del depósito', 'monto neto', 'net amount', 'neto', 'net sales', 'net', 'total before deduction']);

    console.log(`   Columnas: tipo=${iType} estado=${iState} bruto=${iGross} fee=${iFee} neto=${iNet}`);

    // Count by tipo
    const tipoCount = {};
    const estadoCount = {};
    let fileBruto = 0, fileNeto = 0, fileComision = 0, fileTxn = 0, fileRetiros = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c)) continue;

      const tipo = iType >= 0 ? String(row[iType] || '').trim() : '(sin tipo)';
      const estado = iState >= 0 ? String(row[iState] || '').trim() : '';
      const bruto = iGross >= 0 ? parseFloat(String(row[iGross]||'').replace(',','.').replace(/[^\d.-]/g,'')) || 0 : 0;
      const fee   = iFee   >= 0 ? parseFloat(String(row[iFee  ]||'').replace(',','.').replace(/[^\d.-]/g,'')) || 0 : 0;
      const neto  = iNet   >= 0 ? parseFloat(String(row[iNet  ]||'').replace(',','.').replace(/[^\d.-]/g,'')) || 0 : 0;

      const tipoL = tipo.toLowerCase();
      const key = tipo || '(vacío)';
      tipoCount[key] = (tipoCount[key] || { count: 0, bruto: 0, neto: 0 });
      tipoCount[key].count++;
      tipoCount[key].bruto += Math.abs(bruto);
      tipoCount[key].neto  += Math.abs(neto);

      if (estado) estadoCount[estado] = (estadoCount[estado] || 0) + 1;

      // Is this a retiro? (using CURRENT API logic — only retiro/withdrawal/payout)
      const isRetiro = tipoL && (tipoL.includes('retiro') || tipoL.includes('withdrawal') || tipoL.includes('payout'));
      if (isRetiro) {
        fileRetiros += Math.abs(bruto || neto);
        continue;
      }

      // Is it a payment?
      const PAYMENT_TYPES = ['pago', 'payment', 'sale', 'venta', 'cobro', 'card', 'charge'];
      if (tipoL && !PAYMENT_TYPES.some(t => tipoL.includes(t))) continue;

      // Status check
      const SUCCESS = ['exitosa', 'successful', 'completada', 'paid', 'approved', 'confirmed', 'complete'];
      if (estado && !SUCCESS.some(s => estado.toLowerCase().includes(s))) continue;

      if (bruto <= 0 && neto <= 0) continue;
      fileBruto    += Math.abs(bruto);
      fileComision += Math.abs(fee);
      fileNeto     += Math.abs(neto || (bruto - fee));
      fileTxn++;
    }

    console.log(`\n   📊 Por TIPO DE TRANSACCIÓN:`);
    Object.entries(tipoCount).sort((a,b)=>b[1].count-a[1].count).forEach(([t,v])=>{
      console.log(`      "${t}": ${v.count} filas | bruto $${v.bruto.toLocaleString('es-CL',{maximumFractionDigits:0})} | neto $${v.neto.toLocaleString('es-CL',{maximumFractionDigits:0})}`);
    });

    console.log(`\n   📊 Por ESTADO:`);
    Object.entries(estadoCount).sort((a,b)=>b[1]-a[1]).forEach(([e,c])=>{
      console.log(`      "${e}": ${c} filas`);
    });

    console.log(`\n   💰 Totales (según lógica API actual):`);
    console.log(`      Transacciones contadas: ${fileTxn} | Bruto: $${fileBruto.toLocaleString('es-CL',{maximumFractionDigits:0})} | Neto: $${fileNeto.toLocaleString('es-CL',{maximumFractionDigits:0})}`);
    console.log(`      Retiros/payouts:        $${fileRetiros.toLocaleString('es-CL',{maximumFractionDigits:0})}`);

    grandTotal.bruto     += fileBruto;
    grandTotal.neto      += fileNeto;
    grandTotal.comision  += fileComision;
    grandTotal.txn       += fileTxn;
    grandTotal.retiros   += fileRetiros;
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 TOTALES GLOBALES (todos los archivos):`);
  console.log(`   Transacciones: ${grandTotal.txn}`);
  console.log(`   Bruto total:   $${grandTotal.bruto.toLocaleString('es-CL',{maximumFractionDigits:0})} CLP`);
  console.log(`   Neto total:    $${grandTotal.neto.toLocaleString('es-CL',{maximumFractionDigits:0})} CLP`);
  console.log(`   Comisión:      $${grandTotal.comision.toLocaleString('es-CL',{maximumFractionDigits:0})} CLP`);
  console.log(`   Retiros API:   $${grandTotal.retiros.toLocaleString('es-CL',{maximumFractionDigits:0})} CLP`);
  console.log(`   Saldo API:     $${(grandTotal.neto - grandTotal.retiros).toLocaleString('es-CL',{maximumFractionDigits:0})} CLP`);
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
