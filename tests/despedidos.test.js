import { describe, it, expect } from 'vitest';
import { analizarExport } from '@/lib/fleet';
import { payloadPara } from '@/lib/carga/payload';
import { esExportDespedidos, leerDespedidos, liquidar, asignarPorNombre, balancesDeExport, rentaAlDespido, aplicarCambios, validarCuenta, enmascararCuenta } from '@/lib/fleet/despedidos';

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

describe('renta al despido (como la columna PLAZO)', () => {
  // Miércoles 28-10-2026 a las 14:00 Fleet carga la semana del jueves 29 al miércoles 04-11
  it('debía la semana y lo despidieron el viernes: paga solo jueves y viernes', () => {
    const r = rentaAlDespido({ balance: -242000, fecha: '2026-10-28T20:00:00Z' }, 242000, '2026-10-30');
    expect(r).toMatchObject({ cargos: 0, balanceAlDespido: -242000, diasNoUsados: 5, noUsada: 172857 });
    expect(r.neta).toBe(242000 - 172857);
  });

  it('suma las rentas que Fleet cargó después del último export', () => {
    // Último export activo el lunes 19-10 al día; despedido el jueves 22-10
    const r = rentaAlDespido({ balance: 0, fecha: '2026-10-19T15:00:00Z' }, 210000, '2026-10-22');
    expect(r.cargos).toBe(1);                 // miércoles 21-10
    expect(r.balanceAlDespido).toBe(-210000);
    expect(r.diasNoUsados).toBe(6);           // usó solo el jueves 22
    expect(r.neta).toBe(30000);
  });

  it('un export del mismo miércoles antes de las 14:00 todavía no tiene la renta', () => {
    const r = rentaAlDespido({ balance: 0, fecha: '2026-10-21T15:00:00Z' }, 210000, '2026-10-21'); // 12:00 en Chile
    expect(r.cargos).toBe(1);
    expect(r.neta).toBe(0);                   // despedido ese mismo miércoles: no usó la semana nueva
  });

  it('pagado por adelantado queda a favor', () => {
    const r = rentaAlDespido({ balance: 0, fecha: '2026-10-28T20:00:00Z' }, 210000, '2026-10-30');
    expect(r.neta).toBe(-150000);
  });

  it('sin historial ni renta semanal usa el balance tal cual', () => {
    expect(rentaAlDespido(null, 210000, '2026-10-30').neta).toBe(0);
    expect(rentaAlDespido({ balance: -50000, fecha: '2026-10-28T20:00:00Z' }, null, '2026-10-30').neta).toBe(50000);
  });
});

describe('balances del export de conductores', () => {
  it('guarda solo los activos, con RUT, patente y balance', () => {
    const b = balancesDeExport([
      { Name: 'ANGELA SANTIBAÑEZ', 'ID Number': '11.111.111-1', Vehicles: 'VZSS39', Balance: '-242000', 'Bail paid': '50000', 'Activation Status': 'activated' },
      { Name: 'OTRO', 'ID Number': '', Vehicles: '', Balance: '0', 'Activation Status': 'fired' },
    ]);
    expect(b).toEqual([expect.objectContaining({ rut: '11.111.111-1', patente: 'VZSS39', balance: -242000, garantia: 50000 })]);
  });
});

describe('correcciones a mano', () => {
  const base = { renta: 100, tags: 50, multas: 0, otros: 0, garantia: 75000, ajustes: 0 };
  it('manda la última aprobada; las pendientes no cuentan', () => {
    const r = aplicarCambios(base, [
      { campo: 'tags', valor: 10, estado: 'aprobado', propuesto_en: '2026-11-01' },
      { campo: 'tags', valor: 20, estado: 'aprobado', propuesto_en: '2026-11-02' },
      { campo: 'multas', valor: 999, estado: 'pendiente', propuesto_en: '2026-11-03' },
      { campo: 'renta', valor: 0, estado: 'rechazado', propuesto_en: '2026-11-03' },
    ]);
    expect(r.valores).toMatchObject({ tags: 20, multas: 0, renta: 100 });
    expect(r.pendientes.multas).toHaveLength(1);
    expect(r.corregido.tags.valor).toBe(20);
  });
});

describe('cuenta para devolver la garantía', () => {
  const buena = { titular: 'Carlos  Leal', rut: '11111111-1', banco: 'BancoEstado', tipo: 'vista', numero: '1234 5678', email: 'CL@Mail.com' };
  it('limpia y valida los datos', () => {
    expect(validarCuenta(buena).cuenta).toEqual({ titular: 'Carlos Leal', rut: '11.111.111-1', banco: 'BancoEstado', tipo: 'vista', numero: '12345678', email: 'cl@mail.com' });
    expect(validarCuenta({ ...buena, rut: '11111111-2' }).error).toBe('rut');
    expect(validarCuenta({ ...buena, banco: 'Banco X' }).error).toBe('banco');
    expect(validarCuenta({ ...buena, numero: '12' }).error).toBe('numero');
    expect(validarCuenta({ ...buena, email: 'no' }).error).toBe('email');
  });
  it('fuera de gerencia el número va enmascarado y sin RUT', () => {
    const m = enmascararCuenta(validarCuenta(buena).cuenta);
    expect(m).toEqual({ titular: 'Carlos Leal', banco: 'BancoEstado', tipo: 'vista', numero: '•••5678', enmascarada: true });
  });
});
