import { describe, it, expect } from 'vitest';
import { diasHabiles, diasHabilesEnAnio, cruces, validarSolicitud, semanasDelMes, esHabil, visiblesPara } from '@/lib/vacaciones';

describe('días hábiles', () => {
  it('no cuenta fines de semana ni feriados', () => {
    expect(diasHabiles('2026-11-09', '2026-11-15')).toBe(5);     // lunes a domingo
    expect(diasHabiles('2026-12-07', '2026-12-11')).toBe(4);     // el 8 es feriado
    expect(diasHabiles('2026-09-14', '2026-09-20')).toBe(4);     // 18 y 19 fiestas patrias
    expect(esHabil('2026-11-14')).toBe(false);                   // sábado
  });
  it('fechas al revés o inválidas dan 0', () => {
    expect(diasHabiles('2026-11-15', '2026-11-09')).toBe(0);
    expect(diasHabiles('x', '2026-11-09')).toBe(0);
  });
  it('un período que cruza el año se cuenta en cada año', () => {
    expect(diasHabilesEnAnio('2026-12-28', '2027-01-08', 2026)).toBe(4);
    expect(diasHabilesEnAnio('2026-12-28', '2027-01-08', 2027)).toBe(5); // 1-ene feriado
  });
});

describe('cruces con otras personas', () => {
  const lista = [
    { usuario_email: 'javiera.silva@gocab.io', desde: '2026-12-01', hasta: '2026-12-10', estado: 'aprobada' },
    { usuario_email: 'pablogonzalez@gocab.io', desde: '2026-12-05', hasta: '2026-12-06', estado: 'rechazada' },
    { usuario_email: 'andres.cerda@gocab.io', desde: '2026-12-09', hasta: '2026-12-12', estado: 'solicitada' },
  ];
  it('solo las vigentes de otras personas que se pisan', () => {
    expect(cruces(lista, '2026-12-08', '2026-12-09', 'ANDRES.CERDA@gocab.io').map((v) => v.usuario_email)).toEqual(['javiera.silva@gocab.io']);
    expect(cruces(lista, '2026-12-11', '2026-12-20', 'x@gocab.io').map((v) => v.usuario_email)).toEqual(['andres.cerda@gocab.io']);
  });
});

describe('validar una solicitud', () => {
  it('deja los días hábiles calculados', () => {
    expect(validarSolicitud({ desde: '2026-12-14', hasta: '2026-12-18', nota: ' viaje ' }, '2026-11-10')).toEqual({ desde: '2026-12-14', hasta: '2026-12-18', dias: 5, nota: 'viaje' });
  });
  it('rechaza lo que no sirve', () => {
    expect(validarSolicitud({ desde: '2026-12-18', hasta: '2026-12-14' }).error).toBe('orden');
    expect(validarSolicitud({ desde: '2026-11-01', hasta: '2026-11-03' }, '2026-11-10').error).toBe('pasado');
    expect(validarSolicitud({ desde: '2026-11-14', hasta: '2026-11-15' }).error).toBe('sin_habiles');
    expect(validarSolicitud({ desde: '2026-11-01', hasta: '2027-03-01' }).error).toBe('largo');
  });
});

describe('calendario del mes', () => {
  it('semanas de lunes a domingo', () => {
    const s = semanasDelMes(2026, 11); // noviembre 2026 parte en domingo
    expect(s[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(s[s.length - 1][0]).toBe('2026-11-30');
  });
});

describe('quién ve qué', () => {
  const lista = [
    { id: 1, usuario_email: 'pablogonzalez@gocab.io', estado: 'solicitada' },
    { id: 2, usuario_email: 'pablogonzalez@gocab.io', estado: 'aprobada' },
    { id: 3, usuario_email: 'javiera.silva@gocab.io', estado: 'solicitada' },
    { id: 4, usuario_email: 'javiera.silva@gocab.io', estado: 'rechazada' },
  ];
  it('una solicitud pendiente solo la ven quien la pidió y gerencia', () => {
    expect(visiblesPara(lista, 'Javiera.Silva@gocab.io', false).map((v) => v.id)).toEqual([2, 3, 4]);
    expect(visiblesPara(lista, 'pablogonzalez@gocab.io', false).map((v) => v.id)).toEqual([1, 2]);
    expect(visiblesPara(lista, 'andres.cerda@gocab.io', true)).toHaveLength(4);
  });
});
