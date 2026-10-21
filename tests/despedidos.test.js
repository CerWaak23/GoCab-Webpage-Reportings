import { describe, it, expect } from 'vitest';
import { analizarExport } from '@/lib/fleet';
import { payloadPara } from '@/lib/carga/payload';
import { esExportDespedidos, leerDespedidos, liquidar, asignarPorNombre } from '@/lib/fleet/despedidos';

const fila = (o = {}) => ({
  'Phone Number': '+56911111111', Name: 'JUAN PÉREZ', Gender: '', Balance: '0', 'Bail paid': '0', Fines: '0',
  'Activation Status': 'fired', 'Activation Date': '2026-05-01 10:00:00', 'Fire Date': '2026-08-01 12:00:00',
  Country: 'Chile', 'License Number': '', 'License Expiry Date': '', 'ID Number': '12.345.678-5',
  'ID Expiry Date': '', 'Last Logged At': '', Vehicles: '', 'Created At': '2026-05-01 10:00:00',
  'Manager Groups': '', Comment: '', 'From Element': 'No', ...o,
});

describe('reconocer el export de despedidos', () => {
  it('mismas columnas que conductores, pero todos despedidos', () => {
    expect(analizarExport([fila(), fila({ Name: 'ANA', 'ID Number': '' })], {}, '2026-10-21').tipo).toBe('despedidos');
  });
  it('si hay uno activo es un export de conductores', () => {
    expect(analizarExport([fila(), fila({ 'Activation Status': 'active' })], {}, '2026-10-21').tipo).toBe('drivers');
    expect(esExportDespedidos([])).toBe(false);
  });
});

describe('leer despedidos', () => {
  it('saca renta, garantía y fechas; no usa Fines', () => {
    const [d] = leerDespedidos([fila({ Balance: '-242000', 'Bail paid': '50000', Fines: '71506', Name: 'PPD JUAN  PÉREZ' })]);
    expect(d).toMatchObject({ nombre: 'JUAN PÉREZ', balance: -242000, garantia: 50000, despido: '2026-08-01', activacion: '2026-05-01' });
    expect(d.clave).toMatch(/^rut:/);
    expect(d).not.toHaveProperty('multas');
  });
  it('sin RUT válido la llave es el nombre', () => {
    const [d] = leerDespedidos([fila({ 'ID Number': 'abc' })]);
    expect(d.clave).toBe('nom:JUAN PEREZ');
  });
  it('un RUT repetido en el archivo queda una sola vez', () => {
    const a = analizarExport([fila({ Balance: '-1' }), fila({ Balance: '-2' })], {}, '2026-10-21');
    const p = payloadPara(a);
    expect(p).toHaveLength(1);
    expect(p[0].balance).toBe(-2);
  });
});

describe('liquidación', () => {
  it('la garantía cubre la deuda y lo que falta nos lo debe', () => {
    const l = liquidar({ balance: -242000, garantia: 50000 }, { tags: 205110, otros: 0, multas: 0 });
    expect(l.debe).toBe(447110);
    expect(l.conGarantia).toBe(50000);
    expect(l.nosDebe).toBe(397110);
    expect(l.devolver).toBe(0);
  });
  it('si sobra garantía se devuelve', () => {
    const l = liquidar({ balance: 0, garantia: 150000 }, { tags: 2384, multas: 36076 });
    expect(l.nosDebe).toBe(0);
    expect(l.devolver).toBe(150000 - 2384 - 36076);
  });
  it('la renta pagada por adelantado cubre primero, y la garantía queda para devolver', () => {
    // Pagó $200.000 de renta el miércoles y lo despidieron; debía $80.000 en tags
    const l = liquidar({ balance: 200000, garantia: 100000 }, { tags: 80000 });
    expect(l.conRenta).toBe(80000);
    expect(l.conGarantia).toBe(0);
    expect(l.devolver).toBe(100000);
  });
  it('la renta adelantada que sobra no se devuelve: solo la garantía', () => {
    const l = liquidar({ balance: 300000, garantia: 50000 }, {});
    expect(l.devolver).toBe(50000);
    expect(l.nosDebe).toBe(0);
  });
  it('los ajustes del coordinador suman deuda, y uno negativo la rebaja', () => {
    expect(liquidar({ balance: 0, garantia: 50000 }, {}, { ajustes: [{ monto: 70000 }] }).nosDebe).toBe(20000);
    expect(liquidar({ balance: -30000, garantia: 0 }, {}, { ajustes: [{ monto: -30000 }] }).nosDebe).toBe(0);
  });
  it('lo ya devuelto se descuenta de lo que queda por devolver', () => {
    const l = liquidar({ balance: 0, garantia: 150000 }, {}, { devuelto: 100000 });
    expect(l.devolver).toBe(50000);
    expect(liquidar({ balance: 0, garantia: 150000 }, {}, { devuelto: 150000 }).devolver).toBe(0);
  });
});

describe('asignar boletas por nombre', () => {
  const ds = [{ clave: 'a', nombre: 'CARLOS GONZÁLEZ', nombreFleet: 'CARLOS  GONZÁLEZ' }, { clave: 'b', nombre: 'MARTÍN ROJAS', nombreFleet: 'MARTIN ROJAS' }];
  it('calza exacto aunque cambien tildes, espacios o el prefijo PPD', () => {
    expect(asignarPorNombre(ds, 'PPD Carlos Gonzalez')?.clave).toBe('a');
  });
  it('calza si todas las palabras de uno están en el otro', () => {
    expect(asignarPorNombre(ds, 'MARTIN ANDRES ROJAS')?.clave).toBe('b');
  });
  it('con dos posibles no asigna a ninguno', () => {
    const dos = [...ds, { clave: 'c', nombre: 'CARLOS GONZÁLEZ MUÑOZ', nombreFleet: 'CARLOS GONZÁLEZ MUÑOZ' }];
    // Las palabras de los dos despedidos están en la boleta
    expect(asignarPorNombre(dos, 'CARLOS GONZALEZ MUÑOZ PEREZ')).toBeNull();
  });
});
