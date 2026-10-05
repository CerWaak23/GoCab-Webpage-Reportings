import { describe, it, expect } from 'vitest';
import {
  sugerirTaller, sugerirPaga, escalamiento, diasEnTaller, validarIngreso, validarActualizacion,
  validarSalida, gastoDeSalida, reemplazosSinTaller, marcaDelAuto, resumenTalleres,
} from '@/lib/historial/taller';

const CATALOGO = [
  { id: 1, nombre: 'FullMec', marca: 'BAIC', para: 'mantencion' },
  { id: 2, nombre: 'Grass Macul', marca: 'BAIC', para: 'siniestro' },
  { id: 3, nombre: 'Kaufmann Las Parcelas', marca: 'Neta', para: 'ambos' },
  { id: 4, nombre: 'Kaufmann DyP', marca: 'Neta', para: 'siniestro' },
  { id: 5, nombre: 'Indumotora Huechuraba', marca: 'Nammi', para: 'mantencion' },
  { id: 6, nombre: 'Indumotora Santiago Centro', marca: 'Nammi', para: 'siniestro' },
  { id: 7, nombre: 'Otro taller', marca: null, para: 'ambos' },
];

describe('sugerencia de taller (R56)', () => {
  it('BAIC + mantención → FullMec; BAIC + siniestro → Grass Macul', () => {
    expect(sugerirTaller(CATALOGO, { marca: 'BAIC', modelo: 'Eu5' }, 'mantencion').nombre).toBe('FullMec');
    expect(sugerirTaller(CATALOGO, { marca: 'BAIC', modelo: 'Eu5' }, 'siniestro').nombre).toBe('Grass Macul');
  });
  it('Neta + mantención → Kaufmann Las Parcelas', () => {
    expect(sugerirTaller(CATALOGO, { marca: 'Neta', modelo: 'Aya' }, 'mantencion').nombre).toBe('Kaufmann Las Parcelas');
  });
  it('Dongfeng Nammi se reconoce como Nammi', () => {
    expect(marcaDelAuto({ marca: 'Dongfeng', modelo: 'Nammi 001' })).toBe('Nammi');
    expect(sugerirTaller(CATALOGO, { marca: 'Dongfeng', modelo: 'Nammi 001' }, 'falla').nombre).toBe('Indumotora Huechuraba');
  });
  it('marca sin taller propio → Otro taller; un taller inactivo no se sugiere', () => {
    expect(sugerirTaller(CATALOGO, { marca: 'Tesla' }, 'mantencion').nombre).toBe('Otro taller');
    const sinFull = CATALOGO.map((t) => (t.nombre === 'FullMec' ? { ...t, activo: false } : t));
    expect(sugerirTaller(sinFull, { marca: 'BAIC' }, 'mantencion').nombre).toBe('Otro taller');
  });
});

describe('quién paga', () => {
  it('siniestro leve → conductor; grave → compañía; garantía → marca; resto → GoCab', () => {
    expect(sugerirPaga('siniestro', 'leve')).toBe('conductor');
    expect(sugerirPaga('siniestro', 'grave')).toBe('compania');
    expect(sugerirPaga('garantia')).toBe('garantia');
    expect(sugerirPaga('mantencion')).toBe('gocab');
  });
});

describe('escalamiento (AE7, R58)', () => {
  const HOY = '2026-10-20';
  it('4 días sin actualizaciones → supervisor', () => {
    expect(escalamiento({ ingreso: '2026-10-10', ultimaActualizacion: '2026-10-16T15:00:00Z' }, HOY)).toEqual({ nivel: 'supervisor', dias: 4 });
  });
  it('8 días → Gerencia', () => {
    expect(escalamiento({ ingreso: '2026-10-12T09:00:00Z' }, HOY)).toEqual({ nivel: 'gerencia', dias: 8 });
  });
  it('2 días → nada; justo 7 → todavía supervisor', () => {
    expect(escalamiento({ ingreso: '2026-10-18' }, HOY)).toBe(null);
    expect(escalamiento({ ingreso: '2026-10-13' }, HOY).nivel).toBe('supervisor');
  });
  it('días en taller', () => {
    expect(diasEnTaller('2026-10-10T10:00:00Z', '2026-10-14T18:00:00Z')).toBe(4);
    expect(diasEnTaller('2026-10-10', null, HOY)).toBe(10);
  });
});

describe('validaciones', () => {
  const ingreso = { tallerId: 1, motivo: 'mantencion', paga: 'gocab', ingreso: '2026-10-05T10:00', km: '18000', descripcion: 'Mantención 20.000 km' };
  it('ingreso completo → sin errores; sin taller ni descripción → errores', () => {
    expect(validarIngreso(ingreso)).toEqual([]);
    expect(validarIngreso({ ...ingreso, tallerId: null, descripcion: '' })).toEqual(['taller', 'descripcion']);
    expect(validarIngreso({ ...ingreso, km: '' })).toEqual([]);
  });
  it('un presupuesto exige monto', () => {
    expect(validarActualizacion({ texto: 'Envían presupuesto', estado: 'presupuesto' })).toEqual(['monto']);
    expect(validarActualizacion({ texto: 'Envían presupuesto', estado: 'presupuesto', monto: 285600 })).toEqual([]);
    expect(validarActualizacion({ texto: '' })).toEqual(['texto']);
    expect(validarActualizacion({ texto: 'Sale el 15', salidaEstimada: 'mañana' })).toEqual(['salida_estimada']);
    expect(validarActualizacion({ texto: 'Sale el 15', salidaEstimada: '2026-10-15' })).toEqual([]);
  });
  it('la salida no puede ser antes del ingreso', () => {
    expect(validarSalida({ salida: '2026-10-04' }, '2026-10-05T10:00')).toEqual(['salida_antes']);
    expect(validarSalida({ salida: '2026-10-08T12:00', monto: 120000 }, '2026-10-05T10:00')).toEqual([]);
  });
});

describe('gasto y reemplazos', () => {
  it('salida pagada por GoCab suma a gastos con el monto; con garantía no', () => {
    expect(gastoDeSalida({ paga: 'gocab', taller: 'FullMec', ot: 'OT 12' }, { monto: 150000, factura: 'F 4521' }))
      .toEqual({ monto: 150000, proveedor: 'FullMec', documento: 'F 4521' });
    expect(gastoDeSalida({ paga: 'garantia', taller: 'Kaufmann' }, { monto: 0 })).toBe(null);
  });
  it('reemplazo cuyo auto original no tiene ingreso a taller', () => {
    const r = reemplazosSinTaller([{ patente: 'AAAA11', reemplaza_patente: 'BBBB22' }, { patente: 'CCCC33', reemplaza_patente: 'DDDD44' }], ['DDDD44']);
    expect(r.map((x) => x.patente)).toEqual(['AAAA11']);
  });
});

describe('resumen de la cabecera de Talleres', () => {
  it('cuenta fechas de salida, atrasos, listos, escalamientos y motivos', () => {
    const r = resumenTalleres([
      { motivo: 'siniestro', dias: 45, salidaEstimada: '2026-10-10' },
      { motivo: 'siniestro', dias: 20, salidaEstimada: '2026-10-02', escalar: { nivel: 'supervisor' } },
      { motivo: 'garantia', dias: 48, salidaEstimada: null, estado: 'listo_retiro', escalar: { nivel: 'gerencia' } },
      { motivo: 'falla', dias: 7 },
    ], '2026-10-05');
    expect(r).toEqual({
      total: 4, conFecha: 2, atrasados: 1, sinFecha: 2, listos: 1, supervisor: 1, gerencia: 1,
      porMotivo: { siniestro: 2, garantia: 1, falla: 1 }, promedioDias: 30,
    });
  });
  it('sin autos en taller', () => {
    expect(resumenTalleres([], '2026-10-05')).toMatchObject({ total: 0, promedioDias: 0 });
  });
});
