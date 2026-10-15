import { describe, it, expect } from 'vitest';
import { billsDeFilas, ultimoPorDia, parseAmount, leerFilas } from '@/lib/bills/archivo';
import { reporteDesdeVersiones, consolidarPorDia } from '@/lib/bills/desdeVersiones';

describe('lectura de exports de bills (la misma del reporte)', () => {
  const rows = [
    ['Reference', 'Type', 'Status', 'Vehicle', 'Driver', 'Phone Number', 'Amount', 'Paid Amount', 'Total crossings', 'Created At'],
    ['BILL-1', 'Toll', 'Pending', 'BAIC Eu5 (WCRK65)', 'EULOGIO LEYTON ', '+569', '8.436', '0', '16', '2026-10-09 09:02:48'],
    ['BILL-2', 'Energy', 'Completed', 'X (Y)', '', '', '1000', '1000', '', 45678],
    ['BILL-1', 'Toll', 'Partial', 'BAIC Eu5 (WCRK65)', 'EULOGIO LEYTON', '+569', '8436', '4000', '16', '2026-10-09 09:02:48'],
  ];

  it('una bill por referencia; si se repite vale la última fila', () => {
    const bs = billsDeFilas(rows);
    expect(bs).toHaveLength(2);
    expect(bs.find((b) => b.referencia === 'BILL-1')).toMatchObject({ estado: 'Partial', pagado: 4000, monto: 8436, conductor: 'EULOGIO LEYTON' });
  });

  it('el Created At se guarda tal como viene, para que el reporte lo interprete igual', () => {
    expect(billsDeFilas(rows).find((b) => b.referencia === 'BILL-2').creadoTexto).toBe('45678');
  });

  it('los montos se leen como en el reporte', () => {
    expect(parseAmount('$8.436')).toBe(8.436); // así los lee el reporte hoy; Fleet los manda sin puntos
    expect(parseAmount('')).toBe(0);
  });

  it('lee un CSV con punto y coma', () => {
    const csv = Buffer.from('Reference;Amount;Paid Amount\nB1;100;50\n');
    expect(billsDeFilas(leerFilas(csv, 'x.csv'))[0]).toMatchObject({ referencia: 'B1', monto: 100, pagado: 50 });
  });

  it('el último archivo de cada día en hora de Chile', () => {
    const fs = [
      { id: 'a', modifiedTime: '2026-10-01T12:00:00Z' },
      { id: 'b', modifiedTime: '2026-10-01T22:00:00Z' },
      { id: 'c', modifiedTime: '2026-10-02T02:00:00Z' }, // 23:00 del 1 en Chile
      { id: 'd', modifiedTime: '2026-10-02T15:00:00Z' },
    ];
    expect(ultimoPorDia(fs).map((f) => f.id)).toEqual(['c', 'd']);
  });
});

describe('reporte de Bills desde la historia en Supabase', () => {
  const archivos = [
    { id: 1, archivo: 'a.xlsx', subido: '2026-10-01T15:00:00Z', filas: 2, filas_sin_conductor: 0, referencias: ['B1', 'B2'] },
    { id: 2, archivo: 'b.xlsx', subido: '2026-10-02T15:00:00Z', filas: 2, filas_sin_conductor: 0, referencias: ['B1', 'B2'] },
    { id: 3, archivo: 'c.xlsx', subido: '2026-10-03T15:00:00Z', filas: 1, filas_sin_conductor: 0, referencias: ['B1'] },
  ];
  const v = (referencia, archivo_id, pagado, extra = {}) => ({ referencia, archivo_id, tipo: 'Toll', estado: 'Pending', vehiculo: 'X (AAAA11)', conductor: 'ANA', telefono: '', descripcion: '', monto: 1000, pagado, creado_texto: '2026-09-30 10:00:00', ...extra });

  it('un pago es la subida del pagado entre un archivo y el siguiente', () => {
    const r = reporteDesdeVersiones(archivos.slice(0, 2), [v('B1', 1, 0), v('B2', 1, 0), v('B1', 2, 600)]);
    expect(r.paymentEvents).toEqual([expect.objectContaining({ reference: 'B1', amount: 600, date: '2026-10-02T15:00:00.000Z' })]);
    expect(r.snapshots.map((s) => s.totalPaid)).toEqual([0, 600]);
  });

  it('una bill que aparece ya pagada se cobra en su Created At', () => {
    const r = reporteDesdeVersiones(archivos.slice(0, 1), [v('B1', 1, 1000)]);
    expect(r.paymentEvents[0]).toMatchObject({ amount: 1000, date: '2026-09-30 10:00:00' });
  });

  it('se descarta lo que no viene en el último export si conserva el 90% del anterior', () => {
    const vs = [v('B1', 1, 0), v('B2', 1, 0)];
    expect(reporteDesdeVersiones(archivos.slice(0, 2), vs).bills).toHaveLength(2);
    // c.xlsx conserva 1 de 2 (50%): no se poda y se avisa.
    const r = reporteDesdeVersiones(archivos, vs);
    expect(r.bills).toHaveLength(2);
    expect(r.dataWarnings[0].issue).toBe('export_incompleto');
  });

  it('si el archivo nuevo no trae conductor, se mantiene el anterior', () => {
    const r = reporteDesdeVersiones(archivos.slice(0, 2), [v('B1', 1, 0), v('B1', 2, 0, { conductor: '', estado: 'Completed' })]);
    expect(r.bills[0]).toMatchObject({ driver: 'ANA', status: 'Completed' });
  });
});

describe('varios exports el mismo día', () => {
  it('vale el último del día y la última versión de cada bill', () => {
    const archivos = [
      { id: 1, subido: '2026-10-01T13:00:00Z' },
      { id: 2, subido: '2026-10-01T20:00:00Z' },
      { id: 3, subido: '2026-10-02T13:00:00Z' },
    ];
    const versiones = [
      { referencia: 'B1', archivo_id: 1, pagado: 100 },
      { referencia: 'B2', archivo_id: 1, pagado: 0 },
      { referencia: 'B1', archivo_id: 2, pagado: 300 },
      { referencia: 'B1', archivo_id: 3, pagado: 500 },
    ];
    const [as, vs] = consolidarPorDia(archivos, versiones);
    expect(as.map((a) => a.id)).toEqual([2, 3]);
    expect(vs).toEqual([
      { referencia: 'B1', archivo_id: 2, pagado: 300 },
      { referencia: 'B2', archivo_id: 2, pagado: 0 },
      { referencia: 'B1', archivo_id: 3, pagado: 500 },
    ]);
  });
});
