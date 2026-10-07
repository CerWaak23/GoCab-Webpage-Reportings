import { describe, it, expect } from 'vitest';
import vehicles from './fixtures/fleet/vehicles.json';
import drivers from './fixtures/fleet/drivers.json';
import bills from './fixtures/fleet/bills.json';
import fines from './fixtures/fleet/fines.json';
import { detectarTipo } from '@/lib/fleet/detectar';
import { analizarExport } from '@/lib/fleet';
import { leerVehiculos, diferenciasVehiculos } from '@/lib/fleet/vehiculos';
import { leerConductores } from '@/lib/fleet/conductores';
import { normalizarNombre, limpiarNombre } from '@/lib/fleet/nombres';

const HOY = '2026-10-01';

describe('reconocer el tipo de export', () => {
  it('reconoce los cuatro exports por sus columnas', () => {
    expect(detectarTipo(Object.keys(vehicles[0]))).toBe('vehicles');
    expect(detectarTipo(Object.keys(drivers[0]))).toBe('drivers');
    expect(detectarTipo(Object.keys(bills[0]))).toBe('bills');
    expect(detectarTipo(Object.keys(fines[0]))).toBe('fines');
  });

  it('no reconoce un archivo de otro sistema', () => {
    expect(detectarTipo(['Fecha', 'Monto', 'Glosa'])).toBe(null);
    expect(analizarExport([{ Fecha: '1', Monto: '2' }], {}, HOY).tipo).toBe(null);
  });

  it('un archivo vacío se informa como vacío', () => {
    expect(analizarExport([], {}, HOY)).toMatchObject({ tipo: null, error: 'vacio' });
  });
});

describe('vehicles', () => {
  it('cuenta los autos por estado y los que no tienen conductor', () => {
    const r = analizarExport(vehicles, { autos: [] }, HOY);
    expect(r.tipo).toBe('vehicles');
    expect(r.resumen.total).toBe(114);
    expect(r.resumen.porEstado).toEqual({ working: 95, maintenance: 9, available: 6, total_loss: 4 });
    expect(r.resumen.sinConductor).toBe(19);
    expect(r.resumen.sinVin).toBe(1);
  });

  it('usa Plate Number aunque Old Number sea distinto', () => {
    const fila = { ...vehicles[0], 'Plate Number': 'ABCD12', 'Old Number': 'ZZZZ99' };
    expect(leerVehiculos([fila])[0].patente).toBe('ABCD12');
  });

  it('quita el prefijo PPD del nombre del conductor', () => {
    const fila = { ...vehicles[0], Driver: 'PPD ANA SOTO ' };
    expect(leerVehiculos([fila])[0].conductor).toBe('ANA SOTO');
  });

  it('auto con otro conductor en Fleet y sin acta de entrega → falta el acta de entrega', () => {
    const fila = { ...vehicles[0], 'Plate Number': 'ABCD12', Driver: 'LUIS ROJAS', Status: 'working' };
    const base = { autos: [{ patente: 'ABCD12', conductor: null, ultimaActa: { tipo: 'recepcion', conductor: 'LUIS ROJAS' } }] };
    const d = diferenciasVehiculos(leerVehiculos([fila]), base);
    expect(d).toEqual([{ patente: 'ABCD12', tipo: 'cambio_conductor', antes: null, ahora: 'LUIS ROJAS', faltaActa: 'entrega' }]);
  });

  it('cambio de conductor con acta de entrega a ese conductor no pide acta', () => {
    const fila = { ...vehicles[0], 'Plate Number': 'ABCD12', Driver: 'Luis Rojas', Status: 'working' };
    const base = { autos: [{ patente: 'ABCD12', conductor: 'Juan Pérez', ultimaActa: { tipo: 'entrega', conductor: 'LUIS ROJAS' } }] };
    const [d] = diferenciasVehiculos(leerVehiculos([fila]), base);
    expect(d.faltaActa).toBe(null);
  });

  it('auto que Fleet deja sin conductor → falta el acta de recepción', () => {
    const fila = { ...vehicles[0], 'Plate Number': 'ABCD12', Driver: '', Status: 'available' };
    const base = { autos: [{ patente: 'ABCD12', conductor: 'ANA SOTO', ultimaActa: { tipo: 'entrega', conductor: 'ANA SOTO' } }] };
    const [d] = diferenciasVehiculos(leerVehiculos([fila]), base);
    expect(d).toMatchObject({ tipo: 'cambio_conductor', ahora: null, faltaActa: 'recepcion' });
  });

  it('auto de la base que no viene en el archivo solo genera un aviso', () => {
    const base = { autos: [{ patente: 'NOES99', conductor: 'ANA SOTO' }] };
    const d = diferenciasVehiculos(leerVehiculos(vehicles), base);
    expect(d).toContainEqual({ patente: 'NOES99', tipo: 'ausente' });
  });

  it('auto nuevo y disponible sin conductor → fotos de ingreso pendientes', () => {
    const fila = { ...vehicles[0], 'Plate Number': 'NUEV01', Driver: '', Status: 'available' };
    const [d] = diferenciasVehiculos(leerVehiculos([fila]), { autos: [] });
    expect(d).toEqual({ patente: 'NUEV01', tipo: 'nuevo', sinFotosIngreso: true });
  });

  it('el mismo conductor con distinta escritura no es un cambio', () => {
    const fila = { ...vehicles[0], 'Plate Number': 'ABCD12', Driver: 'ANA  DÍAZ ', Status: 'working' };
    const base = { autos: [{ patente: 'ABCD12', conductor: 'Ana Diaz' }] };
    expect(diferenciasVehiculos(leerVehiculos([fila]), base)).toEqual([]);
  });
});

describe('drivers', () => {
  it('lista por nombre los conductores con RUT inválido', () => {
    const r = analizarExport(drivers, { conductores: [] }, HOY);
    expect(r.tipo).toBe('drivers');
    expect(r.resumen.total).toBe(95);
    expect(r.resumen.rutInvalidos).toHaveLength(6);
    expect(typeof r.resumen.rutInvalidos[0]).toBe('string');
  });

  it('un RUT con dígito verificador inválido queda marcado y sin formatear', () => {
    const [c] = leerConductores([{ ...drivers[0], 'ID Number': '12345678-0' }]).conductores;
    expect(c.rutValido).toBe(false);
    expect(c.rut).toBe(null);
    expect(c.rutCrudo).toBe('12345678-0');
  });

  it('cuenta las bajas por Fire Date', () => {
    const r = analizarExport(drivers, { conductores: [] }, HOY);
    expect(r.resumen.bajas).toBe(10);
  });

  it('cuenta cédulas vencidas o por vencer en 60 días', () => {
    const filas = [
      { ...drivers[0], 'ID Expiry Date': '2026-10-15 00:00:00' },
      { ...drivers[1], 'ID Expiry Date': '2026-09-01 00:00:00' },
      { ...drivers[2], 'ID Expiry Date': '2029-01-01 00:00:00' },
      { ...drivers[3], 'ID Expiry Date': '' },
    ];
    expect(analizarExport(filas, { conductores: [] }, HOY).resumen.cedulasPorVencer).toBe(2);
  });

  it('conductores que no están en la base cuentan como nuevos', () => {
    const r = analizarExport(drivers.slice(0, 3), { conductores: [{ nombre: drivers[0].Name }] }, HOY);
    expect(r.resumen.nuevos).toBe(2);
  });

  it('Bail paid con monto es renta y en 0 es drive to own', () => {
    const filas = [
      { ...drivers[0], 'Bail paid': '142507' },
      { ...drivers[1], 'Bail paid': '0' },
      { ...drivers[2], 'Bail paid': '$50.000' },
      { ...drivers[3], 'Bail paid': '' },
    ];
    const cs = leerConductores(filas).conductores;
    expect(cs.map((c) => c.modalidad)).toEqual(['renta', 'drive_to_own', 'renta', null]);
    expect(cs.map((c) => c.garantia)).toEqual([142507, 0, 50000, null]);
    const r = analizarExport(filas, { conductores: [] }, HOY).resumen;
    expect([r.renta, r.driveToOwn]).toEqual([2, 1]);
  });

  it('sin la columna Bail paid la modalidad queda sin dato', () => {
    const [c] = leerConductores([drivers[0]]).conductores;
    expect(c.modalidad).toBe(null);
    expect(c.garantia).toBe(null);
  });
});

describe('bills y fines', () => {
  it('bills: suma solo los saldos positivos', () => {
    const filas = [
      { ...bills[0], Amount: '10000', 'Paid Amount': '10000' },
      { ...bills[0], Amount: '5000', 'Paid Amount': '2000' },
      { ...bills[0], Amount: '3000', 'Paid Amount': '0' },
    ];
    const r = analizarExport(filas, {}, HOY);
    expect(r.tipo).toBe('bills');
    expect(r.resumen).toEqual({ total: 3, conSaldo: 2, saldo: 6000 });
  });

  it('fines: cuenta pendientes y suma el saldo restante', () => {
    const r = analizarExport(fines, {}, HOY);
    expect(r.tipo).toBe('fines');
    expect(r.resumen.total).toBe(45);
    expect(r.resumen.pendientes).toBe(14);
    expect(r.resumen.saldo).toBe(697483);
  });
});

describe('nombres', () => {
  it('quita también el prefijo PDD (PPD mal tipeado en Fleet)', () => {
    expect(normalizarNombre('PDD Jose Videla')).toBe('JOSE VIDELA');
    expect(limpiarNombre('PDD Jose Videla')).toBe('Jose Videla');
  });
  it('compara sin tildes, espacios dobles ni prefijo PPD', () => {
    expect(normalizarNombre('PPD  José  Muñoz ')).toBe('JOSE MUNOZ');
    expect(normalizarNombre('ana díaz')).toBe(normalizarNombre('ANA DIAZ'));
  });
});
