import { describe, it, expect } from 'vitest';
import { leerPasadas, normalizarFechaHora, validarLote, LOTE_MAXIMO } from '@/lib/peajes/gps';
import { bloqueDe, usoDelBloque, usoDeBills, estadoDe, compararPeajes } from '@/lib/peajes/comparar';

const TITULOS = ['id', 'patente', 'imei', 'fecha_entrada', 'fecha_salida', 'tipo_autopista', 'autopista', 'portico', 'tipo_tarifa', 'valor_cobro'];
const pasada = (id, patente, entrada, portico, valor) =>
  [id, patente, '8646', entrada, entrada, 'URBANA', 'Costanera Norte', portico, 'Tarifa normal', valor];

describe('Listado de TAGs del GPS', () => {
  it('lee las pasadas, normaliza la patente y descarta repetidas', () => {
    const r = leerPasadas([
      TITULOS,
      pasada(1, 'VSBH-40', '2026-10-21 08:00:00', 'P7', 250),
      pasada(2, 'VSBH-40', '2026-10-21 08:00:00', 'P7', 250), // la misma pasada dos veces
      pasada(3, 'VSBH-40', '2026-10-21 08:00:00', 'P8', 300), // otro pórtico a la misma hora
      pasada(4, 'WCRK-65', '2026-10-22 23:59:59', 'P1', 181),
    ]);
    expect(r.pasadas).toHaveLength(3);
    expect(r.pasadas[0]).toEqual(['VSBH40', '2026-10-21 08:00:00', '2026-10-21 08:00:00', '8646', 'URBANA', 'Costanera Norte', 'P7', 'Tarifa normal', 250]);
    expect(r.desde).toBe('2026-10-21 08:00:00');
    expect(r.hasta).toBe('2026-10-22 23:59:59');
  });

  it('rechaza un archivo sin las columnas que importan', () => {
    expect(leerPasadas([['patente', 'fecha'], ['VSBH-40', '2026-10-21']]).error).toBe('formato');
  });

  it('acepta la fecha como serial de Excel', () => {
    expect(normalizarFechaHora(46316.5)).toBe('2026-10-21 12:00:00');
    expect(normalizarFechaHora('2026-10-21 08:05')).toBe('2026-10-21 08:05:00');
    expect(normalizarFechaHora('21-10-2026')).toBeNull();
  });

  it('el servidor valida cada lote', () => {
    const buena = ['VSBH40', '2026-10-21 08:00:00', null, null, null, 'Costanera Norte', 'P7', null, 250];
    expect(validarLote([buena]).filas[0]).toMatchObject({ patente: 'VSBH40', portico: 'P7', valor: 250 });
    expect(validarLote([[...buena.slice(0, 8), -5]]).error).toBe('lote');
    expect(validarLote([['VSBH-40', ...buena.slice(1)]]).error).toBe('lote');
    expect(validarLote([buena, ['x']]).error).toBe('lote');
    expect(validarLote(Array(LOTE_MAXIMO + 1).fill(buena)).error).toBe('lote');
  });
});

describe('semana de cobro', () => {
  it('el uso de lunes a domingo se cobra el miércoles siguiente', () => {
    expect(bloqueDe('2026-10-19')).toBe('2026-10-28'); // lunes
    expect(bloqueDe('2026-10-25')).toBe('2026-10-28'); // domingo
    expect(bloqueDe('2026-10-26')).toBe('2026-11-04'); // lunes siguiente
    expect(usoDelBloque('2026-10-28')).toEqual({ lunes: '2026-10-19', domingo: '2026-10-25' });
  });
});

describe('día de uso de cada bill', () => {
  const bill = (referencia, creado, monto = 1000, patente = 'VZSS70') => ({ referencia, patente, creado, monto, cruces: 2 });

  it('el bill del día D es el uso de D-1', () => {
    expect(usoDeBills([bill('a', '2026-10-22T09:02:20')])[0].uso).toBe('2026-10-21');
  });

  it('dos bills el mismo día recuperan el día que faltó', () => {
    const r = usoDeBills([bill('b', '2026-11-01T19:48:18'), bill('a', '2026-11-01T09:02:38'), bill('z', '2026-10-30T09:02:00')]);
    const uso = Object.fromEntries(r.map((b) => [b.referencia, b.uso]));
    expect(uso).toEqual({ z: '2026-10-29', a: '2026-10-30', b: '2026-10-31' });
  });

  it('con el GPS, cada bill de recuperación va al día que más se le parece', () => {
    // 01-11 en VYJL84: el de las 09:02 era el sábado 31 y el de las 19:48 el viernes 30
    const gps = { '2026-10-30': 24645, '2026-10-31': 10517 };
    const r = usoDeBills([bill('a', '2026-11-01T09:02:38', 10531, 'VYJL84'), bill('b', '2026-11-01T19:48:18', 24657, 'VYJL84')], (p, dia) => gps[dia]);
    expect(Object.fromEntries(r.map((b) => [b.referencia, b.uso]))).toEqual({ a: '2026-10-31', b: '2026-10-30' });
  });

  it('no corre un bill a un día que ya tiene el suyo', () => {
    const r = usoDeBills([bill('ayer', '2026-10-21T09:00:00'), bill('a', '2026-10-22T09:00:00'), bill('b', '2026-10-22T10:00:00')]);
    expect(r.filter((b) => b.uso === '2026-10-21').map((b) => b.referencia).sort()).toEqual(['a', 'b']);
  });

  it('deja fuera los ajustes retroactivos sin pasadas', () => {
    expect(usoDeBills([{ ...bill('r', '2026-10-22T09:00:00', 50000), cruces: 0 }])).toHaveLength(0);
  });
});

describe('estado de la diferencia', () => {
  it('unos pesos de redondeo cuadran', () => {
    expect(estadoDe(18117, 18141)).toBe('ok');
    expect(estadoDe(50000, 49600)).toBe('ok'); // 1%
    expect(estadoDe(18683, 0)).toBe('falta');
    expect(estadoDe(2321, 5529)).toBe('demas');
  });
});

describe('GPS contra Fleet por conductor', () => {
  const b = (referencia, patente, creado, monto, conductorId) => ({ referencia, patente, creado, monto, cruces: 3, conductorId, conductor: null });
  const nombres = new Map([['c1', 'LEONEL CERDA'], ['c2', 'OTRO']]);

  it('un viernes sin bill queda como no cargado al conductor del auto', () => {
    const r = compararPeajes({
      gpsDias: [
        { patente: 'VZSS72', dia: '2026-10-22', monto: 892, pasadas: 2 },
        { patente: 'VZSS72', dia: '2026-10-23', monto: 5000, pasadas: 9 }, // viernes: Fleet no emitió
        { patente: 'VZSS72', dia: '2026-10-24', monto: 2102, pasadas: 4 },
      ],
      bills: [b('j', 'VZSS72', '2026-10-23T09:02:00', 893, 'c1'), b('d', 'VZSS72', '2026-10-25T09:02:00', 2103, 'c1')],
      nombres,
      encargados: { VZSS72: 'J. Silva' },
    });
    expect(r.hasta).toBe('2026-10-24');
    expect(r.filas).toHaveLength(1);
    const f = r.filas[0];
    expect(f).toMatchObject({ conductor: 'LEONEL CERDA', bloque: '2026-10-28', gps: 7994, fleet: 2996, estado: 'falta', encargado: 'J. Silva' });
    expect(f.dias.find((d) => d.dia === '2026-10-23').nota).toBe('sin_bill');
    expect(r.diasSinBills).toEqual([{ dia: '2026-10-23', gps: 5000 }]);
  });

  it('un cambio de conductor a mitad de semana separa las filas', () => {
    const r = compararPeajes({
      gpsDias: [{ patente: 'VYJF64', dia: '2026-10-20', monto: 1000, pasadas: 2 }, { patente: 'VYJF64', dia: '2026-10-22', monto: 2000, pasadas: 4 }],
      bills: [b('x', 'VYJF64', '2026-10-21T09:00:00', 1000, 'c1'), b('y', 'VYJF64', '2026-10-23T09:00:00', 2000, 'c2')],
      nombres,
    });
    expect(r.filas.map((f) => [f.conductor, f.gps, f.estado]).sort()).toEqual([['LEONEL CERDA', 1000, 'ok'], ['OTRO', 2000, 'ok']]);
  });

  it('no compara días más allá de donde llegan el GPS o los bills', () => {
    const r = compararPeajes({
      gpsDias: [{ patente: 'VZSS70', dia: '2026-10-20', monto: 1000, pasadas: 2 }, { patente: 'VZSS70', dia: '2026-10-21', monto: 9000, pasadas: 9 }],
      bills: [b('x', 'VZSS70', '2026-10-21T09:00:00', 1000, 'c1')],
      nombres,
    });
    expect(r.hasta).toBe('2026-10-20');
    expect(r.filas[0]).toMatchObject({ gps: 1000, fleet: 1000, estado: 'ok' });
  });

  it('un bill sin pasadas en el GPS es cargado de más', () => {
    const r = compararPeajes({
      gpsDias: [{ patente: 'VZSS70', dia: '2026-10-21', monto: 100, pasadas: 1 }],
      bills: [b('x', 'VZSS70', '2026-10-21T09:00:00', 6148, 'c1'), b('y', 'VZSS70', '2026-10-22T09:00:00', 100, 'c1')],
      nombres,
    });
    const f = r.filas[0];
    expect(f.estado).toBe('demas');
    expect(f.dias.find((d) => d.dia === '2026-10-20').nota).toBe('sin_gps');
  });
});
