import { describe, it, expect } from 'vitest';
import { cuotasVencidas, estadoGarantia, topeDe } from '@/lib/fleet/garantia';

// Octubre 2026: lun 5, mié 7, dom 11, mié 14, jue 15, mié 21, jue 22
describe('cuotas de garantía por miércoles de pago', () => {
  it('el miércoles de la semana en que partió no cobra', () => {
    expect(cuotasVencidas('2026-10-05', '2026-10-08')).toBe(0); // partió lunes: ese miércoles no
    expect(cuotasVencidas('2026-10-05', '2026-10-15')).toBe(1); // el miércoles siguiente sí
    expect(cuotasVencidas('2026-10-05', '2026-10-22')).toBe(2);
  });
  it('el miércoles en curso cuenta recién desde el jueves', () => {
    expect(cuotasVencidas('2026-10-05', '2026-10-14')).toBe(0);
    expect(cuotasVencidas('2026-10-05', '2026-10-21')).toBe(1);
  });
  it('partir un miércoles tampoco cobra ese día', () => {
    expect(cuotasVencidas('2026-10-07', '2026-10-08')).toBe(0);
    expect(cuotasVencidas('2026-10-07', '2026-10-15')).toBe(1);
  });
  it('partir un domingo cobra el miércoles de tres días después', () => {
    expect(cuotasVencidas('2026-10-11', '2026-10-15')).toBe(1);
  });
  it('sin fechas válidas no hay cuotas', () => {
    expect(cuotasVencidas(null, '2026-10-21')).toBe(0);
    expect(cuotasVencidas('2026-10-21', '2026-10-01')).toBe(0);
  });
});

describe('estado de la garantía', () => {
  it('el ejemplo: tercera semana con solo la entrega son 2 atrasadas', () => {
    // partió lun 5: el jueves 22 debe la entrega + mié 14 + mié 21 = 100.000
    const e = estadoGarantia({ garantia: 50000, activacion: '2026-10-05', modalidad: 'renta' }, '2026-10-22');
    expect(e.debia).toBe(100000);
    expect(e.atraso).toBe(2);
  });
  it('una cuota a medio pagar cuenta como atrasada', () => {
    const e = estadoGarantia({ garantia: 60000, activacion: '2026-10-05', modalidad: 'renta' }, '2026-10-22');
    expect(e.falta).toBe(40000);
    expect(e.atraso).toBe(2);
  });
  it('no pide más que el tope', () => {
    const e = estadoGarantia({ garantia: 250000, activacion: '2026-06-01', modalidad: 'renta' }, '2026-10-21');
    expect(e.debia).toBe(250000);
    expect(e.atraso).toBe(0);
    expect(e.completa).toBe(true);
  });
  it('los activados desde el 1 de septiembre llegan a 300.000', () => {
    expect(topeDe('2026-08-31')).toBe(250000);
    expect(topeDe('2026-09-01')).toBe(300000);
    const e = estadoGarantia({ garantia: 250000, activacion: '2026-09-01', modalidad: 'renta' }, '2027-01-01');
    expect(e.completa).toBe(false);
    expect(e.atraso).toBe(2);
  });
  it('drive to own no tiene plan, y sin datos se dice', () => {
    expect(estadoGarantia({ garantia: 0, activacion: '2026-10-05', modalidad: 'drive_to_own' }, '2026-10-21').aplica).toBe(false);
    expect(estadoGarantia({ garantia: null, activacion: '2026-10-05', modalidad: null }, '2026-10-21').sinDato).toBe(true);
  });
});
