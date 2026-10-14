import { describe, it, expect } from 'vitest';
import { construirMaestra, filasHoja, validarEdicion, edicionesDesdeHoja, ultimasEdiciones, diferenciasConHoja } from '@/lib/maestra/maestra';
import { leerBills, leerMultas, patenteDeVehiculo } from '@/lib/fleet/cobros';
import { payloadPara } from '@/lib/carga/payload';

const conductores = [
  { id: 'c1', nombre: 'Ana Rojas', nombre_fleet: 'PPD ANA ROJAS', rut: '11.111.111-1', activacion: '2026-06-01', modalidad: 'renta' },
  { id: 'c2', nombre: 'Luis Soto', nombre_fleet: 'LUIS SOTO', rut: null, rut_crudo: '123', activacion: '2026-07-01', modalidad: 'drive_to_own' },
];
const autos = [
  { patente: 'AAAA11', estado_fleet: 'working', grupo: 'J.Varela', modalidad: null },
  { patente: 'BBBB22', estado_fleet: 'working', grupo: 'P.Gonzalez', modalidad: null },
  { patente: 'CCCC33', estado_fleet: 'maintenance', grupo: 'P.Gonzalez', modalidad: 'renta' },
  { patente: 'DDDD44', estado_fleet: 'total_loss', grupo: null, modalidad: 'renta' },
  { patente: 'FAKECAR', estado_fleet: 'available', grupo: null },
];
const vigentes = [{ patente: 'AAAA11', conductor_id: 'c1' }, { patente: 'BBBB22', conductor_id: 'c2' }];
const anteriores = [{ patente: 'CCCC33', conductor_id: 'c2', hasta: '2026-09-01' }];
const base = { autos, conductores, vigentes, anteriores, encargados: { 'J.Varela': 'J. Silva' } };
const fila = (m, p) => m.find((f) => f.patente === p);

describe('maestra de Control Flota', () => {
  it('una fila por auto, sin FAKECAR, con el nombre de Fleet y la fecha de activación', () => {
    const m = construirMaestra(base);
    expect(m.map((f) => f.patente)).not.toContain('FAKECAR');
    expect(m).toHaveLength(4);
    expect(fila(m, 'AAAA11').nombre.valor).toBe('PPD ANA ROJAS');
    expect(fila(m, 'AAAA11').creado).toBe('2026-06-01');
  });

  it('el grupo de Fleet se traduce al nombre de la hoja', () => {
    const m = construirMaestra(base);
    expect(fila(m, 'AAAA11').encargado.valor).toBe('J. Silva');
    expect(fila(m, 'BBBB22').encargado.valor).toBe('P.Gonzalez');
  });

  it('el tipo sale de la modalidad del conductor; un total loss dice TOTAL LOSS', () => {
    const m = construirMaestra(base);
    expect(fila(m, 'AAAA11').tipo.valor).toBe('Renta');
    expect(fila(m, 'BBBB22').tipo.valor).toBe('DTO');
    expect(fila(m, 'DDDD44').tipo.valor).toBe('TOTAL LOSS');
  });

  it('un total loss va sin conductor y con TOTAL LOSS en Rut, Created At y Tipo', () => {
    const m = construirMaestra({ ...base, vigentes: [...vigentes, { patente: 'DDDD44', conductor_id: 'c1' }] });
    expect(filasHoja(m).find((r) => r[1] === 'DDDD44')).toEqual(['', 'DDDD44', 'TOTAL LOSS', 'TOTAL LOSS', '', 'TOTAL LOSS']);
  });

  it('un auto en taller queda sin nombre pero con el RUT de su último conductor', () => {
    const f = fila(construirMaestra(base), 'CCCC33');
    expect(f.nombre.valor).toBe(null);
    expect(f.rut.valor).toBe('123');
    expect(f.conductorRutId).toBe('c2');
  });

  it('las correcciones a mano mandan, y una vacía vuelve a Fleet', () => {
    const ediciones = [
      { conductor_id: 'c2', campo: 'rut', valor: '22.222.222-2', autor_email: 'a@gocab.io', creado: '2026-10-01T10:00:00Z' },
      { patente: 'BBBB22', campo: 'encargado', valor: 'J. Silva', autor_email: 'a@gocab.io', creado: '2026-10-01T10:00:00Z' },
      { patente: 'BBBB22', campo: 'encargado', valor: null, autor_email: 'a@gocab.io', creado: '2026-10-02T10:00:00Z' },
    ];
    const m = construirMaestra({ ...base, ediciones });
    expect(fila(m, 'BBBB22').rut).toMatchObject({ valor: '22.222.222-2', fleet: '123', editado: true });
    // El RUT corregido sigue al conductor, también en el auto que tuvo antes.
    expect(fila(m, 'CCCC33').rut.valor).toBe('22.222.222-2');
    expect(fila(m, 'BBBB22').encargado).toMatchObject({ valor: 'P.Gonzalez', editado: false });
  });

  it('la última corrección de cada campo es la que vale', () => {
    const eds = ultimasEdiciones([
      { patente: 'X', campo: 'tipo', valor: 'DTO', creado: '2026-10-02' },
      { patente: 'X', campo: 'tipo', valor: 'Renta', creado: '2026-10-01' },
    ]);
    expect(eds.get('auto:X:tipo').valor).toBe('DTO');
  });

  it('filas para la hoja con el mismo encabezado que Control Flota', () => {
    const filas = filasHoja(construirMaestra(base));
    expect(filas[0]).toEqual(['Name', 'Vehicles', 'Rut', 'Created At', 'Encargado', 'Tipo']);
    expect(filas.find((r) => r[1] === 'AAAA11')).toEqual(['PPD ANA ROJAS', 'AAAA11', '11.111.111-1', '2026-06-01', 'J. Silva', 'Renta']);
  });

  it('valida las correcciones', () => {
    expect(validarEdicion('rut', '22222222-2')).toEqual({ valor: '22.222.222-2' });
    expect(validarEdicion('rut', '22222222-3')).toEqual({ error: 'rut' });
    expect(validarEdicion('tipo', 'renta')).toEqual({ valor: 'Renta' });
    expect(validarEdicion('tipo', 'otro')).toEqual({ error: 'tipo' });
    expect(validarEdicion('encargado', '  ')).toEqual({ valor: null });
    expect(validarEdicion('patente', 'X')).toEqual({ error: 'campo' });
  });

  it('toma de la hoja actual solo las correcciones reales', () => {
    const m = construirMaestra(base);
    const hoja = [
      { Name: 'ANA ROJAS', Vehicles: 'AAAA11', Rut: '11.111.111-1', Encargado: 'J. Silva', Tipo: 'Renta' }, // igual (sin PPD)
      { Name: 'LUIS SOTO', Vehicles: 'BBBB22', Rut: '22.222.222-2', Encargado: 'J. Silva', Tipo: 'Renta' },
      { Name: '', Vehicles: 'CCCC33', Rut: '22.222.222-2', Encargado: 'P.Gonzalez', Tipo: 'Renta' },
    ];
    expect(edicionesDesdeHoja(m, hoja)).toEqual([
      { patente: 'BBBB22', campo: 'encargado', valor: 'J. Silva' },
      { patente: 'BBBB22', campo: 'tipo', valor: 'Renta' },
      { conductor_id: 'c2', campo: 'rut', valor: '22.222.222-2' },
    ]);
  });
});

describe('comparar con la hoja que se mantenía a mano', () => {
  it('marca solo los campos distintos, sin contar PPD ni el formato del RUT', () => {
    const m = construirMaestra(base);
    const hoja = [
      { Name: 'ANA ROJAS', Vehicles: 'AAAA11', Rut: '11111111-1', Encargado: 'J. Silva', Tipo: 'renta' },
      { Name: 'OTRA PERSONA', Vehicles: 'BBBB22', Rut: '123', Encargado: 'P.Gonzalez', Tipo: 'DTO' },
      { Name: '', Vehicles: 'CCCC33', Rut: '123', Encargado: 'P.Gonzalez', Tipo: '' },
    ];
    const d = diferenciasConHoja(m, hoja);
    expect(d.AAAA11).toBeUndefined();
    expect(d.BBBB22).toEqual({ nombre: 'OTRA PERSONA' });
    expect(d.CCCC33).toEqual({ tipo: '' });
    expect(d.DDDD44).toEqual({ falta: true });
  });
});

describe('bills y multas fila por fila', () => {
  it('saca la patente del texto del vehículo', () => {
    expect(patenteDeVehiculo('BAIC Eu5 (WCRK65)')).toBe('WCRK65');
    expect(patenteDeVehiculo('VYJW15')).toBe('VYJW15');
    expect(patenteDeVehiculo('')).toBe(null);
  });

  it('lee bills y deja una fila por referencia', () => {
    const filas = [
      { Reference: 'BILL-1', Type: 'Toll', Status: 'Pending', Vehicle: 'BAIC Eu5 (WCRK65)', Driver: 'EULOGIO  LEYTON ', 'Phone Number': '+56929733013', Amount: '8436', 'Paid Amount': '0', 'Total crossings': '16', 'Created At': '2026-10-09 09:02:48' },
      { Reference: 'BILL-1', Type: 'Toll', Status: 'Completed', Vehicle: 'BAIC Eu5 (WCRK65)', Driver: 'EULOGIO LEYTON', Amount: '8436', 'Paid Amount': '8436', 'Created At': '2026-10-09 09:02:48' },
      { Reference: '', Amount: '1' },
    ];
    const bs = leerBills(filas);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ referencia: 'BILL-1', estado: 'Completed', patente: 'WCRK65', pagado: 8436, creado: '2026-10-09 09:02:48' });
  });

  it('lee multas con su saldo y su coordinador', () => {
    const [m] = leerMultas([{ 'Date of contravention': '2026-09-21 00:00:00', 'Created At': '2026-10-05 16:37:14', Reference: 'FN1', 'Bill Reference': '025707-30-26', Description: 'X', Vehicle: 'Neta Aya (VYJW15)', 'Vehicle Number': 'VYJW15', Driver: 'CARLOS', 'Driver Name': 'CARLOS ALAMOS', 'Amount to pay': '54113', 'Paid Amount': '0', 'Remaining Amount': '54113', Status: 'Pending', 'Vehicle Speed': '0', Manager: 'Javiera Silva', 'Manager Group': 'P.Gonzalez' }]);
    expect(m).toMatchObject({ referencia: 'FN1', fecha: '2026-09-21', patente: 'VYJW15', conductor: 'CARLOS ALAMOS', saldo: 54113, velocidad: 0, grupo: 'P.Gonzalez' });
  });

  it('el payload de bills lleva el conductor identificado', () => {
    const datos = payloadPara({ tipo: 'bills', datos: [{ referencia: 'B', conductor: 'X' }] }, () => 'id-1');
    expect(datos[0]).toMatchObject({ referencia: 'B', conductorId: 'id-1' });
  });
});
