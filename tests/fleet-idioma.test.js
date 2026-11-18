import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { traducirFilas, traducirObjetos } from '@/lib/fleet/idioma';
import { analizarExport } from '@/lib/fleet';
import { billsDeFilas, leerFilas } from '@/lib/bills/archivo';

// El mismo export de bills, bajado de Fleet en inglés y en español
const EN = [
  ['Reference', 'Type', 'Status', 'Vehicle', 'Driver', 'Phone Number', 'Amount', 'Paid Amount', 'Total crossings', 'Created At'],
  ['BILL-1', 'Toll', 'Completed', 'BAIC Eu5 (WCRK65)', 'EULOGIO LEYTON ', '+569', '4350', '4350', '7', '2026-11-18 09:02:50'],
  ['BILL-2', 'Energy', 'Pending', 'BAIC Eu5 (WCRK65)', 'EULOGIO LEYTON ', '+569', '1000', '0', '', '2026-11-18 10:00:00'],
  ['BILL-3', 'Reparation', 'Partial', 'X (AB1234)', 'ANA', '+568', '9000', '3000', '', '2026-11-18 11:00:00'],
  ['BILL-4', 'Administrative', 'Pending', 'X (AB1234)', 'ANA', '+568', '500', '0', '', '2026-11-18 12:00:00'],
];
const ES = [
  ['Referencia', 'Tipo', 'Estado', 'Vehículo', 'Conductor', 'Número de teléfono', 'Monto', 'Monto Pagado', 'Total de pasajes', 'Fecha de creación'],
  ['BILL-1', 'Peaje', 'Terminado', 'BAIC Eu5 (WCRK65)', 'EULOGIO LEYTON ', '+569', '4350', '4350', '7', '2026-11-18 09:02:50'],
  ['BILL-2', 'Energía', 'Pendiente', 'BAIC Eu5 (WCRK65)', 'EULOGIO LEYTON ', '+569', '1000', '0', '', '2026-11-18 10:00:00'],
  ['BILL-3', 'Reparación', 'Parcial', 'X (AB1234)', 'ANA', '+568', '9000', '3000', '', '2026-11-18 11:00:00'],
  ['BILL-4', 'Administrativo', 'Pendiente', 'X (AB1234)', 'ANA', '+568', '500', '0', '', '2026-11-18 12:00:00'],
];
const comoObjetos = (rows) => rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])));
const xlsx = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

describe('exports de Fleet bajados en español', () => {
  it('un export de bills en español queda igual que el mismo en inglés', () => {
    expect(traducirFilas(ES)).toEqual(EN);
    expect(traducirObjetos(comoObjetos(ES))).toEqual(comoObjetos(EN));
  });

  it('se reconoce como bills en Carga de datos y se lee igual que en inglés', () => {
    const es = analizarExport(traducirObjetos(comoObjetos(ES)), {}, '2026-11-18');
    const en = analizarExport(comoObjetos(EN), {}, '2026-11-18');
    expect(es.tipo).toBe('bills');
    expect(es).toEqual(en);
    expect(es.datos[0]).toMatchObject({ tipo: 'Toll', estado: 'Completed', monto: 4350, pagado: 4350, cruces: 7, patente: 'WCRK65' });
  });

  it('la historia de bills (leerFilas desde el archivo) sale en inglés', () => {
    expect(billsDeFilas(leerFilas(xlsx(ES), 'export-7606-bills.xlsx'))).toEqual(billsDeFilas(leerFilas(xlsx(EN), 'export-7598-bills.xlsx')));
  });

  it('un export en inglés no se toca', () => {
    expect(traducirFilas(EN)).toBe(EN);
    const objs = comoObjetos(EN);
    expect(traducirObjetos(objs)).toBe(objs);
  });

  it('un archivo con algunas palabras en español pero sin la firma completa no se toca', () => {
    const otro = [['Referencia', 'Estado'], ['X', 'Pendiente']];
    expect(traducirFilas(otro)).toBe(otro);
  });

  it('un valor que no está en la lista se deja como viene', () => {
    const rows = [ES[0], ['BILL-9', 'Multa', 'Anulado', '', '', '', '1', '0', '', '']];
    expect(traducirFilas(rows)[1]).toEqual(['BILL-9', 'Multa', 'Anulado', '', '', '', '1', '0', '', '']);
  });

  it('vacío o sin filas no falla', () => {
    expect(traducirFilas([])).toEqual([]);
    expect(traducirObjetos([])).toEqual([]);
    expect(traducirFilas(undefined)).toBeUndefined();
  });
});
