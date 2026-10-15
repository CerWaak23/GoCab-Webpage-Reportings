import { describe, it, expect } from 'vitest';
import { billsDeFilas, ultimoPorDia, parseAmount, leerFilas } from '@/lib/bills/archivo';

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
