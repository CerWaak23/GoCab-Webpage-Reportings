import { describe, it, expect } from 'vitest';
import { reporteMultas } from '@/lib/multas/reporte';

const fila = (clave, extra = {}) => ({
  clave, base: clave, ref: clave.split('|')[0], fechaContravencion: clave.split('|')[1], cargo: 36000, pago: 0,
  estado: 'pending', conductor: 'ANA', vehiculo: 'NETA AYA (VYKH24)', creado: '2026-09-01 10:00:00', descripcion: '', ...extra,
});
const archivo = (filas, modifiedTime = '2026-09-02T12:00:00Z') => ({ name: 'f.xlsx', modifiedTime, formatoDesconocido: false, encabezado: [], filas });

describe('multas que no son deuda', () => {
  it('una multa anulada en Fleet no se cuenta', () => {
    const r = reporteMultas([archivo([fila('A|2026-09-21', { estado: 'cancelled', conductor: 'BENJAMIN YANEZ' }), fila('B|2026-09-24')])]);
    expect(r.fines.map((f) => f.reference)).toEqual(['B|2026-09-24']);
  });

  it('las excluidas a mano no se cuentan, con sus pagos', () => {
    const r = reporteMultas([
      archivo([fila('V11912227|2026-08-19', { conductor: 'CESAR HERMOSILLA' }), fila('V11994958|2026-09-24', { conductor: 'PPD CESAR HERMOSILLA' })]),
      archivo([fila('V11912227|2026-08-19', { conductor: 'CESAR HERMOSILLA', pago: 1000 })], '2026-09-10T12:00:00Z'),
    ], { excluidas: [{ clave: 'V11912227|2026-08-19', motivo: 'conductor equivocado' }] });
    expect(r.fines.map((f) => [f.reference, f.driver])).toEqual([['V11994958|2026-09-24', 'PPD CESAR HERMOSILLA']]);
    expect(r.paymentEvents).toEqual([]);
  });

  it('un pagado que baja es un pago revertido', () => {
    const r = reporteMultas([
      archivo([fila('B|2026-09-24')]),
      archivo([fila('B|2026-09-24', { pago: 36000 })], '2026-09-10T12:00:00Z'),
      archivo([fila('B|2026-09-24', { pago: 0 })], '2026-09-12T12:00:00Z'),
    ]);
    expect(r.paymentEvents.map((p) => p.amount)).toEqual([36000, -36000]);
  });
});
