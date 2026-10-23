import { describe, it, expect } from 'vitest';
import { rutsEnTexto, montoDevolucion, leerFilaDevolucion, asignarDevoluciones, esVerde } from '@/lib/fleet/devoluciones';

const VERDE = { red: 182 / 255, green: 215 / 255, blue: 168 / 255 };

describe('leer la hoja de devoluciones', () => {
  it('encuentra el RUT escrito de cualquier forma', () => {
    expect(rutsEnTexto('Rafael Gomez26342268-6\nCuenta rut banco estado')).toEqual(['26.342.268-6']);
    expect(rutsEnTexto('Ariel Medina\nRUT: 136784986\nMercado Pago')).toEqual(['13.678.498-6']);
    expect(rutsEnTexto('CRISTOPHER PENROZ\n17.518.272-1\nBCI')).toEqual(['17.518.272-1']);
    expect(rutsEnTexto('Javier Fuentes.\nRut: 15.365.395-k')).toEqual(['15.365.395-K']);
  });
  it('descarta números que no son RUT (dígito verificador)', () => {
    expect(rutsEnTexto('Cuenta 12345678-0')).toEqual([]);
  });
  it('lee montos con y sin formato', () => {
    expect(montoDevolucion('$124.646')).toBe(124646);
    expect(montoDevolucion('75000')).toBe(75000);
    expect(montoDevolucion('37.849')).toBe(37849);
  });
  it('verde es devuelta; blanco con ESTADO pendiente no', () => {
    expect(esVerde(VERDE)).toBe(true);
    expect(esVerde({ red: 1, green: 1, blue: 1 })).toBe(false);
    expect(leerFilaDevolucion(['Ana Pérez\n12.345.678-5', '$50.000', 'ENVIADO', ''], VERDE, 2).devuelta).toBe(true);
    expect(leerFilaDevolucion(['Ana Pérez\n12.345.678-5', '$50.000', 'PENDIENTE', ''], { red: 1, green: 1, blue: 1 }, 3).devuelta).toBe(false);
    expect(leerFilaDevolucion(['Cuenta', 'Monto', 'ESTADO', 'OBSERVACIONES'], null, 1)).toBeNull();
  });
});

describe('asignar devoluciones a despedidos', () => {
  const ds = [
    { clave: 'rut:12.345.678-5', rut: '12.345.678-5', nombre: 'ANA PÉREZ', nombreFleet: 'ANA PÉREZ' },
    { clave: 'rut:17.518.272-1', rut: '17.518.272-1', nombre: 'CRISTOPHER PATRICIO PENROZ IBACETA', nombreFleet: 'CRISTOPHER PATRICIO PENROZ IBACETA' },
    { clave: 'nom:MAURICIO MARTINEZ', rut: null, nombre: 'MAURICIO MARTINEZ', nombreFleet: 'MAURICIO MARTINEZ' },
  ];
  it('por RUT, y suma dos devoluciones de la misma persona', () => {
    const filas = [
      leerFilaDevolucion(['CRISTOPHER PATRICIO PENROZ IBACETA\n17.518.272-1', '$50.000', 'ENVIADO'], VERDE, 9),
      leerFilaDevolucion(['CRISTOPHER PATRICIO PENROZ IBACETA\n17.518.272-1', '61146', 'ENVIADO'], VERDE, 18),
    ];
    const { porClave } = asignarDevoluciones(filas, ds);
    expect(porClave.get('rut:17.518.272-1').map((x) => x.monto)).toEqual([50000, 61146]);
  });
  it('sin RUT, por nombre', () => {
    const fila = leerFilaDevolucion(['Mauricio Martinez Santibanez \n Banco falabella \nCuenta corriente \n19823137864', '38500', 'ENVIADO'], VERDE, 15);
    expect(asignarDevoluciones([fila], ds).porClave.get('nom:MAURICIO MARTINEZ')).toHaveLength(1);
  });
  it('lo que no calza queda aparte', () => {
    const fila = leerFilaDevolucion(['Marco Diaz Vasquez\n19.064.721-8', '47492', 'PENDIENTE'], null, 19);
    const r = asignarDevoluciones([fila], ds);
    expect(r.porClave.size).toBe(0);
    expect(r.sinAsignar).toHaveLength(1);
  });
});
