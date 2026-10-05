import { describe, it, expect } from 'vitest';
import vehicles from './fixtures/fleet/vehicles.json';
import drivers from './fixtures/fleet/drivers.json';
import bills from './fixtures/fleet/bills.json';
import fines from './fixtures/fleet/fines.json';
import { crearIndice, buscarConductor, normalizarTelefono } from '@/lib/fleet/identidad';
import { revisarCalidad } from '@/lib/fleet/calidad';
import { leerPatentes } from '@/lib/patente';
import { avisosCarga, numeroExport } from '@/lib/carga/avisos';

const base = [
  { id: 'pedro', nombre: 'PPD Pedro Felipe Bustos Cárcamo', telefono: '+56 9 1111 2222', patentes: ['AAAA11'] },
  { id: 'cesar1', nombre: 'César Hermosilla', telefono: '+56933334444', patentes: ['VYKK33', 'RRRR10'] },
  { id: 'cesar2', nombre: 'CESAR  HERMOSILLA ', telefono: '+56955556666', patentes: 'VVCG35' },
  { id: 'ana', nombre: 'Ana María de la Fuente', telefono: '', patentes: ['BBBB22'] },
];
const indice = crearIndice(base);

describe('identificar al conductor entre archivos', () => {
  it('nombre con otro formato: tildes, espacios, mayúsculas y prefijo PPD', () => {
    expect(buscarConductor({ nombre: '  pedro felipe  BUSTOS carcamo ' }, indice)).toEqual({ id: 'pedro', por: 'nombre' });
  });
  it('mismas palabras en otro orden', () => {
    expect(buscarConductor({ nombre: 'Bustos Carcamo Pedro Felipe' }, indice)).toEqual({ id: 'pedro', por: 'orden' });
  });
  it('nombre incompleto, como en "Driver Name" de multas', () => {
    expect(buscarConductor({ nombre: 'Pedro Bustos' }, indice)).toEqual({ id: 'pedro', por: 'parcial' });
    expect(buscarConductor({ nombre: 'Ana Fuente' }, indice)).toEqual({ id: 'ana', por: 'parcial' });
  });
  it('un solo nombre no basta para identificar', () => {
    expect(buscarConductor({ nombre: 'Pedro' }, indice)).toBe(null);
  });
  it('homónimos: se desempata por patente o teléfono', () => {
    expect(buscarConductor({ nombre: 'Cesar Hermosilla', patente: 'VVCG35' }, indice)).toEqual({ id: 'cesar2', por: 'nombre' });
    expect(buscarConductor({ nombre: 'Cesar Hermosilla', patente: 'VYKK33' }, indice)).toEqual({ id: 'cesar1', por: 'nombre' });
  });
  it('conductor con auto de reemplazo: cualquiera de sus patentes desempata', () => {
    expect(buscarConductor({ nombre: 'Cesar Hermosilla', patente: 'RRRR10' }, indice)).toEqual({ id: 'cesar1', por: 'nombre' });
  });
  it('lee varias patentes en una celda', () => {
    expect(leerPatentes('VYKK33, vv-cg35')).toEqual(['VYKK33', 'VVCG35']);
    expect(leerPatentes('VYKK33 VVCG35')).toEqual(['VYKK33', 'VVCG35']);
    expect(leerPatentes('AB 1234')).toEqual(['AB1234']);
    expect(leerPatentes('')).toEqual([]);
  });
  it('homónimos sin forma de desempatar quedan ambiguos, no se adivina', () => {
    expect(buscarConductor({ nombre: 'Cesar Hermosilla' }, indice)).toEqual({ ambiguo: true, por: 'nombre' });
  });
  it('el teléfono identifica aunque el nombre venga distinto', () => {
    expect(buscarConductor({ nombre: 'C. Hermosilla R.', telefono: '955556666' }, indice)).toEqual({ id: 'cesar2', por: 'telefono' });
  });
  it('un teléfono mal cargado no se lleva la deuda a otra persona', () => {
    expect(buscarConductor({ nombre: 'Pedro Bustos', telefono: '+56933334444' }, indice)).toEqual({ id: 'pedro', por: 'parcial' });
  });
  it('teléfono con o sin +56 9 es el mismo', () => {
    expect(normalizarTelefono('+56 9 1111 2222')).toBe(normalizarTelefono('911112222'));
    expect(normalizarTelefono('123')).toBe(null);
  });
});

describe('calidad de los cuatro exports', () => {
  const conductores = drivers.map((d, i) => ({ id: `c${i}`, nombre: d['Name'], telefono: d['Phone Number'], patentes: d['Vehicles'] }));
  const patentes = vehicles.map((v) => v['Plate Number']);

  it('drivers: cuenta RUT inválidos y detecta RUT y patentes repetidas', () => {
    const malo = [...drivers, { ...drivers[1] }];
    const c = revisarCalidad('drivers', malo, { patentes });
    expect(c.problemas.rut_invalido).toBe(6);
    expect(c.problemas.rut_repetido).toBeGreaterThanOrEqual(1);
    expect(c.graves).toBeGreaterThanOrEqual(1);
  });
  it('vehicles: patentes repetidas o con formato raro', () => {
    const malo = [...vehicles, { ...vehicles[0] }, { ...vehicles[1], 'Plate Number': 'X1' }];
    const c = revisarCalidad('vehicles', malo, { conductores, patentes });
    expect(c.problemas.patente_repetida).toBe(1);
    expect(c.problemas.patente_invalida).toBe(1);
  });
  it('vehicles: todos los conductores del archivo se identifican', () => {
    const c = revisarCalidad('vehicles', vehicles, { conductores, patentes });
    expect(c.cruce.sin + c.cruce.ambiguo).toBe(0);
  });
  it('multas: usa el nombre completo y cae al nombre corto si falta', () => {
    const c = revisarCalidad('fines', fines.map((f) => ({ ...f, Driver: '' })), { conductores, patentes });
    expect(c.cruce.nombre + c.cruce.orden + c.cruce.parcial).toBeGreaterThan(0);
  });
  it('un conductor con dos autos (reemplazo) se informa pero no es error grave', () => {
    const conDos = vehicles.map((v) => ({ ...v }));
    const [a, b] = conDos.filter((v) => v['Driver']);
    b['Driver'] = a['Driver'];
    const antes = revisarCalidad('vehicles', vehicles, { patentes }).problemas.conductor_repetido || 0;
    const c = revisarCalidad('vehicles', conDos, { patentes });
    expect(c.problemas.conductor_repetido).toBe(antes + 1);
    expect(c.graves).toBe(0);
  });
  it('bills: montos ilegibles y patentes fuera de la flota', () => {
    const malo = [{ ...bills[0], Amount: 'abc' }, { ...bills[1], Vehicle: 'Toyota Yaris (ZZZZ99)' }];
    const c = revisarCalidad('bills', malo, { conductores, patentes });
    expect(c.problemas.monto_invalido).toBe(1);
    expect(c.problemas.patente_no_existe).toBe(1);
  });
  it('sin conductores en la base no se informa cruce', () => {
    expect(revisarCalidad('bills', bills, {}).cruce).toBe(null);
  });
});

describe('avisos por cargas repetidas o dudosas', () => {
  const previas = [{ filas: 100, numero_export: 5841, sha256: 'abc', creado: '2026-10-05T15:00:00Z' }];
  it('lee el número del export desde el nombre', () => {
    expect(numeroExport('export-5841-vehicles.xlsx')).toBe(5841);
    expect(numeroExport('vehiculos (1).xlsx')).toBe(null);
  });
  it('el mismo archivo dos veces', () => {
    expect(avisosCarga({ filas: 100, numero: 5841, sha256: 'abc' }, previas)).toContain('mismo_archivo');
  });
  it('un export más viejo que el último aplicado', () => {
    expect(avisosCarga({ filas: 100, numero: 5800, sha256: 'x' }, previas)).toEqual(['export_antiguo']);
  });
  it('un archivo con muchas menos filas (filtro puesto en Fleet)', () => {
    expect(avisosCarga({ filas: 40, numero: 5900, sha256: 'x' }, previas)).toEqual(['filas_bajan']);
  });
  it('muchos errores graves', () => {
    expect(avisosCarga({ filas: 100, numero: 5900, sha256: 'x', graves: 6 }, previas)).toEqual(['muchos_errores']);
  });
  it('un export nuevo y sano no tiene avisos', () => {
    expect(avisosCarga({ filas: 98, numero: 5900, sha256: 'x', graves: 0 }, previas)).toEqual([]);
    expect(avisosCarga({ filas: 98, numero: null, sha256: 'x' }, [])).toEqual([]);
  });
});
