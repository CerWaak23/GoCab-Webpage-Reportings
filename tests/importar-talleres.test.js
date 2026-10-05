import { describe, it, expect } from 'vitest';
import { fechaHoja, motivoFila, tallerFila, horaAvance, pasoDesdeFila } from '@/lib/historial/importarTalleres';

describe('importar talleres desde Control Flota', () => {
  it('lee fechas con barra o guion; "SIN FECHA" queda vacía', () => {
    expect(fechaHoja('18/06/2026')).toBe('2026-06-18');
    expect(fechaHoja('11-09-2026')).toBe('2026-09-11');
    expect(fechaHoja('SIN FECHA')).toBe(null);
  });

  it('motivo del tipo de novedad o deducido del taller', () => {
    expect(motivoFila('SINIESTRO', 'KAUFMANN')).toEqual({ motivo: 'siniestro', deducido: false });
    expect(motivoFila('DAÑO-USO', 'FULLMEC')).toEqual({ motivo: 'falla', deducido: false });
    expect(motivoFila('', 'GARANTIA BAIC')).toEqual({ motivo: 'garantia', deducido: true });
    expect(motivoFila('', 'GRASS - SINIESTRO')).toEqual({ motivo: 'siniestro', deducido: true });
    expect(motivoFila('', 'FULLMEC')).toEqual({ motivo: 'falla', deducido: true });
  });

  it('Kaufmann sin sucursal: siniestro → DyP; el resto → Las Parcelas', () => {
    expect(tallerFila('Kauffmann', 'siniestro')).toBe('Kaufmann DyP');
    expect(tallerFila('KAUFMANN', 'falla')).toBe('Kaufmann Las Parcelas');
  });

  it('nombres de taller de la hoja → catálogo', () => {
    expect(tallerFila('INDUMOTORA -COQUIMBO')).toBe('Indumotora Santiago Centro');
    expect(tallerFila('fullmec')).toBe('FullMec');
    expect(tallerFila('GRASS - SINIESTRO')).toBe('Grass Macul');
    expect(tallerFila('LLANTA')).toBe(null);
  });

  it('hora del avance, con o sin día', () => {
    expect(horaAvance('10:54', '2026-10-05')).toBe('2026-10-05T10:54:00-03:00');
    expect(horaAvance('17:01            01/10', '2026-10-05')).toBe('2026-10-01T17:01:00-03:00');
    expect(horaAvance('', '2026-10-05')).toBe('2026-10-05T12:00:00-03:00');
  });

  it('fila cerrada: salida con días; pérdida total anotada', () => {
    const p = pasoDesdeFila(['vsbh-40', 'PERDIDA TOTAL', 'BAIC', '18/06/2026', '08/07/2026', 'FULLMEC', '', '', '', 'Choque', 'Juan', 'SINIESTRO'], 2, '2026-10-05');
    expect(p.abierto).toBe(false);
    expect(p.patente).toBe('VSBH40');
    expect(p.detalle).toMatchObject({ taller: 'FullMec', motivo: 'siniestro', paga: 'compania', dias: 20, notaSalida: 'Pérdida total' });
    expect(p.actualizacion).toBe(null);
  });

  it('fila en taller: abierta, egreso como estimado y el avance como primera actualización', () => {
    const p = pasoDesdeFila(['VYJL84', 'EN TALLER', '', '31-08-2026', 'SIN FECHA', 'KAUFMANN', 'Esperando repuestos', '9:51', '', 'Choque trasero', '', 'SINIESTRO'], 9, '2026-10-05');
    expect(p.abierto).toBe(true);
    expect(p.detalle).toMatchObject({ taller: 'Kaufmann DyP', salidaEstimada: null, importado: 'control_flota', filaHoja: 9 });
    expect(p.detalle.salida).toBeUndefined();
    expect(p.actualizacion).toEqual({ fecha: '2026-10-05T09:51:00-03:00', texto: 'Esperando repuestos' });
  });

  it('custodia queda abierta y anotada; taller desconocido → Otro taller con el nombre de la hoja', () => {
    const p = pasoDesdeFila(['VZSS84', 'CUSTODIA', '', '18/08/2026', '02/10/2026', 'MiGps migps', '', '', '', '', '', ''], 3, '2026-10-05');
    expect(p.abierto).toBe(true);
    expect(p.detalle).toMatchObject({ taller: 'Otro taller', tallerHoja: 'MiGps migps', salidaEstimada: '2026-10-02' });
    expect(p.detalle.descripcion).toMatch(/^En custodia/);
  });

  it('sin fecha de ingreso no se importa', () => {
    expect(pasoDesdeFila(['VYJL84', 'DISPONIBLE', '', '', '', 'FULLMEC'], 4, '2026-10-05')).toMatchObject({ error: 'ingreso' });
  });
});
