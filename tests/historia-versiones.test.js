import { describe, it, expect } from 'vitest';
import { ultimasAntesDe, cambiosDelArchivo } from '@/lib/historia/versiones';

const bill = (referencia, pagado, extra = {}) => ({ referencia, tipo: 'Toll', estado: 'Pending', vehiculo: 'X', conductor: 'ANA', telefono: '', descripcion: '', monto: 100, pagado, creadoTexto: '2026-09-30', ...extra });
const guardada = (b, subido) => ({ ...b, subido, creado_texto: b.creadoTexto, monto: String(b.monto), pagado: String(b.pagado) });

describe('qué filas de un export se guardan en la historia', () => {
  it('se guardan las nuevas y las que cambiaron, con su posición en el archivo', () => {
    const ultimas = ultimasAntesDe([guardada(bill('B1', 0), '2026-10-01T15:00:00Z'), guardada(bill('B2', 0), '2026-10-01T15:00:00Z')], 'bills', '2026-10-02T15:00:00Z');
    const r = cambiosDelArchivo([bill('B1', 0), bill('B2', 50), bill('B3', 0)], ultimas, 'bills');
    expect(r.versiones.map((v) => [v.referencia, v.orden])).toEqual([['B2', 2], ['B3', 3]]);
    expect([r.nuevas, r.cambios]).toEqual([1, 1]);
  });

  it('un monto guardado como texto ("100") es igual al número 100', () => {
    const ultimas = ultimasAntesDe([guardada(bill('B1', 0), '2026-10-01T15:00:00Z')], 'bills', '2026-10-02T15:00:00Z');
    expect(cambiosDelArchivo([bill('B1', 0)], ultimas, 'bills').versiones).toEqual([]);
  });

  it('un cambio de teléfono también cuenta', () => {
    const ultimas = ultimasAntesDe([guardada(bill('B1', 0), '2026-10-01T15:00:00Z')], 'bills', '2026-10-02T15:00:00Z');
    expect(cambiosDelArchivo([bill('B1', 0, { telefono: '+569' })], ultimas, 'bills').cambios).toBe(1);
  });

  it('un export viejo cargado tarde se compara con lo que había en su momento', () => {
    const lista = [guardada(bill('B1', 0), '2026-10-01T15:00:00Z'), guardada(bill('B1', 100), '2026-10-05T15:00:00Z')];
    expect(ultimasAntesDe(lista, 'bills', '2026-10-03T15:00:00Z').get('B1').pagado).toBe('0');
  });

  it('multas: la clave es referencia|fecha', () => {
    const m = { clave: 'R|2026-09-01', base: 'R|2026-09-01', ref: 'R', fechaContravencion: '2026-09-01', cargo: 1000, pago: 0, estado: 'pending', conductor: '', vehiculo: '', creado: '', descripcion: '' };
    const ultimas = ultimasAntesDe([{ ...m, subido: '2026-10-01T00:00:00Z', referencia: 'R', fecha_contravencion: '2026-09-01' }], 'fines', '2026-10-02T00:00:00Z');
    expect(cambiosDelArchivo([m, { ...m, clave: 'R|2026-09-01#2' }], ultimas, 'fines').versiones.map((v) => v.clave)).toEqual(['R|2026-09-01#2']);
  });
});
