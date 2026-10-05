import { describe, it, expect } from 'vitest';
import vehicles from './fixtures/fleet/vehicles.json';
import drivers from './fixtures/fleet/drivers.json';
import { analizarExport } from '@/lib/fleet';
import { payloadPara, ordenarParaAplicar, hoyEnChile } from '@/lib/carga/payload';
import { permisoCarga, validarArchivo } from '@/lib/carga/permisos';

const HOY = '2026-10-01';

describe('payload para la base', () => {
  it('vehicles: una fila por auto, con la clave del conductor normalizada', () => {
    const p = payloadPara(analizarExport(vehicles, { autos: [] }, HOY));
    expect(p).toHaveLength(114);
    const conConductor = p.find((a) => a.conductor);
    expect(conConductor.clave).toBe(conConductor.clave.toUpperCase());
    expect(p.filter((a) => !a.conductor).every((a) => a.clave === null)).toBe(true);
  });

  it('drivers: lleva el RUT formateado o null si es inválido', () => {
    const p = payloadPara(analizarExport(drivers, { conductores: [] }, HOY));
    expect(p).toHaveLength(95);
    expect(p.filter((c) => c.rut === null)).toHaveLength(6);
    expect(p.filter((c) => c.rut).every((c) => /^\d{1,2}\.\d{3}\.\d{3}-[\dK]$/.test(c.rut))).toBe(true);
  });

  it('bills y fines no escriben filas en la base', () => {
    expect(payloadPara({ tipo: 'bills' })).toEqual([]);
    expect(payloadPara({ tipo: 'fines' })).toEqual([]);
  });

  it('aplica conductores antes que autos, y luego bills y multas', () => {
    const orden = ordenarParaAplicar([{ tipo: 'fines' }, { tipo: 'vehicles' }, { tipo: 'bills' }, { tipo: 'drivers' }]);
    expect(orden.map((c) => c.tipo)).toEqual(['drivers', 'vehicles', 'bills', 'fines']);
  });

  it('la fecha de hoy es la de Chile, no la de UTC', () => {
    // 2 de octubre 02:00 UTC = 1 de octubre 23:00 en Santiago (UTC-3)
    expect(hoyEnChile(new Date('2026-10-02T02:00:00Z'))).toBe('2026-10-01');
  });
});

describe('permisos de Carga de datos', () => {
  const gerente = { role: 'Gerente de Operaciones', isManager: true };
  const coord = { role: 'Coordinador de Flota', isManager: false };
  const taller = { role: 'Encargado de taller', isManager: false };

  it('sin sesión: 401', () => expect(permisoCarga(null, 'revisar')).toBe(401));
  it('gerencia puede revisar y aplicar', () => {
    expect(permisoCarga(gerente, 'revisar')).toBe(null);
    expect(permisoCarga(gerente, 'aplicar')).toBe(null);
  });
  it('un coordinador revisa pero no aplica', () => {
    expect(permisoCarga(coord, 'revisar')).toBe(null);
    expect(permisoCarga(coord, 'aplicar')).toBe(403);
  });
  it('el encargado de taller no entra', () => expect(permisoCarga(taller, 'revisar')).toBe(403));
});

describe('validar archivo antes de subir', () => {
  it('acepta xlsx, xls y csv de hasta 10 MB', () => {
    expect(validarArchivo('export-5733-vehicles.xlsx', 50000)).toEqual({ ext: 'xlsx' });
    expect(validarArchivo('a.CSV', 10)).toEqual({ ext: 'csv' });
  });
  it('rechaza otros formatos, archivos vacíos o demasiado grandes', () => {
    expect(validarArchivo('factura.pdf', 100).error).toBe('extension');
    expect(validarArchivo('a.xlsx', 0).error).toBe('tamano');
    expect(validarArchivo('a.xlsx', 11 * 1024 * 1024).error).toBe('tamano');
  });
});
