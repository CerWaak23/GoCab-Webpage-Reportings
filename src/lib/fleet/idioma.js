/**
 * Exports de Fleet descargados con la interfaz en español.
 *
 * Fleet traduce los encabezados y algunos valores según el idioma de quien
 * exporta, pero todo GoBills lee los nombres en inglés (detectar.js, cobros.js,
 * bills/archivo.js) y guarda los valores en inglés (bills.tipo = 'Toll' lo usan
 * los peajes). Por eso un export en español se traduce al leerlo, antes que
 * cualquier otra cosa lo mire, y el resto del sistema no se entera.
 *
 * Solo se traduce un export que se reconoce entero como español por su firma:
 * así no se toca nada de un export en inglés ni de otros archivos.
 *
 * Las equivalencias salen de comparar, fila por fila, el mismo export de bills
 * bajado en inglés y en español (8.299 referencias, 18-11-2026). Un valor que no
 * esté en la lista se deja como viene. Para agregar fines, drivers o vehicles
 * en español hace falta un export real de cada uno en ese idioma.
 */
const EXPORTS_ES = [
  {
    tipo: 'bills',
    firma: ['Referencia', 'Tipo', 'Monto', 'Monto Pagado'],
    encabezados: {
      Referencia: 'Reference',
      Tipo: 'Type',
      Estado: 'Status',
      Vehículo: 'Vehicle',
      Conductor: 'Driver',
      'Número de teléfono': 'Phone Number',
      Monto: 'Amount',
      'Monto Pagado': 'Paid Amount',
      'Total de pasajes': 'Total crossings',
      'Fecha de creación': 'Created At',
    },
    // Por columna, ya con su nombre en inglés
    valores: {
      Type: {
        Peaje: 'Toll',
        Energía: 'Energy',
        Reparación: 'Reparation',
        Administrativo: 'Administrative',
      },
      Status: {
        Terminado: 'Completed',
        Pendiente: 'Pending',
        Parcial: 'Partial',
      },
    },
  },
];

const limpio = (v) => String(v ?? '').normalize('NFC').trim();

/** La traducción que corresponde a estos encabezados, o null si no es un export en español conocido. */
function exportEnEspanol(encabezados) {
  const set = new Set((encabezados || []).map(limpio));
  return EXPORTS_ES.find((e) => e.firma.every((c) => set.has(c))) || null;
}

const traducirEncabezado = (e, h) => e.encabezados[limpio(h)] ?? h;

function traducirValor(e, columna, v) {
  const tabla = e.valores[columna];
  if (!tabla || typeof v !== 'string') return v;
  return tabla[limpio(v)] ?? v;
}

/** Filas como arreglos (la primera es el encabezado), como las da sheet_to_json con header: 1. */
export function traducirFilas(rows) {
  if (!rows || rows.length === 0) return rows;
  const e = exportEnEspanol(rows[0]);
  if (!e) return rows;
  const encabezado = rows[0].map((h) => traducirEncabezado(e, h));
  return [
    encabezado,
    ...rows.slice(1).map((row) => row.map((v, i) => traducirValor(e, encabezado[i], v))),
  ];
}

/** Filas como objetos (encabezado → valor), como las da sheet_to_json sin header. */
export function traducirObjetos(filas) {
  if (!filas || filas.length === 0) return filas;
  const e = exportEnEspanol(Object.keys(filas[0]));
  if (!e) return filas;
  return filas.map((fila) => {
    const nueva = {};
    for (const [h, v] of Object.entries(fila)) {
      const columna = traducirEncabezado(e, h);
      nueva[columna] = traducirValor(e, columna, v);
    }
    return nueva;
  });
}
