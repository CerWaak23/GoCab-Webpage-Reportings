/**
 * Lectura de los exports de bills, la misma para el reporte de Bills
 * (src/app/api/bills/route.js) y para guardar su historia en Supabase
 * (registrar_bills_version, migración 0009). Si cambia cómo se lee un export,
 * cambia en los dos lados a la vez.
 */
import * as XLSX from 'xlsx';

export function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ── HTML-in-cells parser ───────────────────────────────────────────────────────
// Some exports (e.g. GoCab billing system) dump a full HTML table into an Excel
// where every row in column A is one line of raw HTML.  We detect this case and
// parse the embedded table instead of treating the cells as normal data.

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')        // remove all tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function isHtmlFile(rows) {
  // Check if first few non-empty cells look like HTML markup
  const sample = rows.slice(0, 10).flat().filter(Boolean).map(String);
  return sample.some(c => /^<(tr|td|table|thead|tbody)/i.test(c.trim()));
}

export function parseHtmlRows(rows) {
  // Concatenate all cells into one HTML string
  const html = rows.map(r => r.join('')).join('\n');

  // Extract every <tr> block
  const tableRows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM;
  while ((trM = trRe.exec(html)) !== null) {
    const cells = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;  // match <td> and <th>
    let tdM;
    while ((tdM = tdRe.exec(trM[1])) !== null) {
      cells.push(stripHtml(tdM[1]));
    }
    if (cells.some(c => c)) tableRows.push(cells);
  }
  return tableRows;
}

/** Filas de un export (xlsx, xls o csv) como arreglos, con el caso HTML-en-celdas resuelto. */
export function leerFilas(buffer, nombre, { html = true } = {}) {
  const name = String(nombre || '').toLowerCase();
  let rows;
  if (name.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/);
    const delim = lines[0]?.includes(';') ? ';' : ',';
    rows = lines.map(l => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim()));
  } else {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  }
  // El export de multas nunca viene como HTML en celdas; el reporte de multas no lo revisa.
  if (html && isHtmlFile(rows)) rows = parseHtmlRows(rows);
  return rows;
}

/**
 * Filas → bills con las mismas columnas que busca el reporte. Si una
 * referencia se repite en el archivo, vale la última fila (como en el reporte).
 */
export function billsDeFilas(rows) {
  if (!rows || rows.length < 2) return [];
  const header = rows[0].map((h) => String(h).toLowerCase().trim());
  const col = (names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };
  const iRef = col(['reference', 'ref']);
  const iType = col(['type', 'tipo']);
  const iStatus = col(['status', 'estado']);
  const iVehicle = col(['vehicle', 'vehículo', 'vehiculo']);
  const iDriver = col(['driver', 'conductor']);
  const iPhone = col(['phone', 'teléfono', 'telefono']);
  const iAmount = col(['amount', 'monto', 'total']);
  const iPaid = col(['paid amount', 'paid', 'pagado']);
  const iDesc = col(['description', 'descripción', 'descripcion']);
  const iDate = col(['created at', 'created', 'fecha']);
  const txt = (row, i) => (i >= 0 ? String(row[i] ?? '').trim() : '');

  const porRef = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const referencia = iRef >= 0 ? String(row[iRef] || '') : String(i);
    if (!referencia) continue;
    porRef.set(referencia, {
      referencia,
      tipo: txt(row, iType),
      estado: txt(row, iStatus),
      vehiculo: txt(row, iVehicle),
      conductor: txt(row, iDriver),
      telefono: txt(row, iPhone),
      descripcion: txt(row, iDesc),
      monto: parseAmount(iAmount >= 0 ? row[iAmount] : 0),
      pagado: parseAmount(iPaid >= 0 ? row[iPaid] : 0),
      creadoTexto: iDate >= 0 ? String(row[iDate] ?? '') : '',
    });
  }
  return [...porRef.values()];
}

/** El último archivo de cada día en Chile (los archivos deben venir de más antiguo a más nuevo). */
export function ultimoPorDia(archivos, fecha = (a) => a.modifiedTime) {
  const porDia = new Map();
  for (const a of archivos) {
    porDia.set(new Date(fecha(a)).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }), a);
  }
  return [...porDia.values()];
}
