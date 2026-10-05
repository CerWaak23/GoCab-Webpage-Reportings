import { describe, it, expect } from 'vitest';
import {
  TOMAS_PROTOCOLO, TOMAS_OBLIGATORIAS, TOMAS_OPCIONALES, eventoDeReferencia, referenciasPorToma, validarActa, resumenActa,
  pendientesDeRecepcion, itemsChecklist,
} from '@/lib/historial/actas';

const SHA = 'b'.repeat(64);
const CHECK = { version: 1, items: [{ grupo: 'Equipamiento', items: ['Triángulo', 'Extintor'] }, { grupo: 'Estado', items: ['Limpieza interior'] }] };
const ITEMS = itemsChecklist(CHECK);

const acta = (cambios = {}) => ({
  tipo: 'entrega',
  conductor: { id: 'c1' },
  pideCedula: false,
  fotos: Object.fromEntries(TOMAS_PROTOCOLO.map((t) => [t, { sha256: SHA }])),
  checklist: Object.fromEntries(ITEMS.map((i) => [i, { estado: 'ok' }])),
  km: 18420,
  firma: { sha256: SHA },
  clausula: 'v1',
  ...cambios,
});

describe('foto de referencia de la recepción (R23)', () => {
  it('prefiere la última entrega', () => {
    const e = eventoDeReferencia([
      { id: 'lev', tipo: 'levantamiento', fecha: '2026-10-08' },
      { id: 'ent', tipo: 'entrega', fecha: '2026-09-01' },
      { id: 'ing', tipo: 'ingreso', fecha: '2026-08-01' },
    ]);
    expect(e.id).toBe('ent');
  });
  it('AE1: sin entrega usa el levantamiento; las tomas que no tiene quedan sin referencia', () => {
    const e = eventoDeReferencia([{ id: 'lev', tipo: 'levantamiento', fecha: '2026-10-08' }, { id: 'ing', tipo: 'ingreso', fecha: '2026-08-01' }]);
    expect(e.id).toBe('lev');
    const refs = referenciasPorToma([{ toma: 'frente' }, { toma: 'trasera' }, { toma: 'tablero' }, { toma: 'lateral_izquierdo' }]);
    expect(refs.frente).toEqual({ toma: 'frente' });
    expect(refs.lateral_izquierdo).toEqual({ toma: 'lateral_izquierdo' });
    expect(refs.esquina_del_izq).toBe(null);
    expect(Object.keys(refs)).toHaveLength(TOMAS_PROTOCOLO.length);
  });
  it('sin entrega ni levantamiento usa el ingreso; sin nada, null', () => {
    expect(eventoDeReferencia([{ id: 'ing', tipo: 'ingreso', fecha: '2026-08-01' }]).id).toBe('ing');
    expect(eventoDeReferencia([{ tipo: 'siniestro', fecha: '2026-08-01' }])).toBe(null);
  });
});

describe('validar el acta', () => {
  it('completa → sin errores', () => expect(validarActa(acta(), ITEMS)).toEqual([]));

  it('las 5 del levantamiento son obligatorias, o el motivo si no se pudo (R70)', () => {
    expect(TOMAS_OBLIGATORIAS).toEqual(['frente', 'trasera', 'lateral_izquierdo', 'lateral_derecho', 'tablero']);
    const a = acta();
    delete a.fotos.trasera;
    a.fotos.tablero = { noSePudo: true, motivo: 'no' };
    expect(validarActa(a, ITEMS)).toEqual(['falta_trasera', 'motivo_tablero']);
  });

  it('las otras tomas son opcionales: se pueden saltar, pero si van, con foto válida', () => {
    const a = acta();
    for (const t of TOMAS_OPCIONALES) delete a.fotos[t];
    expect(validarActa(a, ITEMS)).toEqual([]);
    a.fotos.maleta = { sha256: 'malo' };
    expect(validarActa(a, ITEMS)).toEqual(['foto_maleta']);
  });

  it('cada elemento de la checklist marcado OK, Falta o Dañado', () => {
    const a = acta();
    delete a.checklist['Extintor'];
    a.checklist['Triángulo'] = { estado: 'tal vez' };
    expect(validarActa(a, ITEMS)).toEqual(['check_Triángulo', 'check_Extintor']);
  });

  it('una firma vacía no habilita el cierre', () => {
    expect(validarActa(acta({ firma: null }), ITEMS)).toEqual(['firma']);
    expect(validarActa(acta({ firma: null }), ITEMS, { conFirma: false })).toEqual([]);
  });

  it('AE4: con la cédula registrada no se pide; sin ella, ambos lados', () => {
    expect(validarActa(acta({ pideCedula: false }), ITEMS)).toEqual([]);
    expect(validarActa(acta({ pideCedula: true, cedula: { cedula_frente: { sha256: SHA } } }), ITEMS)).toEqual(['cedula_reverso']);
  });

  it('conductor provisional necesita nombre y RUT', () => {
    expect(validarActa(acta({ conductor: { provisional: { nombre: 'Ana', rut: '' } } }), ITEMS)).toEqual(['provisional']);
    expect(validarActa(acta({ conductor: { provisional: { nombre: 'Ana', rut: '12.345.678-5' } } }), ITEMS)).toEqual([]);
    expect(validarActa(acta({ conductor: null }), ITEMS)).toEqual(['conductor']);
  });

  it('km obligatorio', () => expect(validarActa(acta({ km: '' }), ITEMS)).toEqual(['km']));

  it('"No aplica" es una respuesta válida de la checklist', () => {
    const a = acta();
    a.checklist['Extintor'] = { estado: 'no_aplica' };
    expect(validarActa(a, ITEMS)).toEqual([]);
    expect(resumenActa(a, ITEMS).checklist).toMatchObject({ ok: 2, no_aplica: 1 });
  });

  it('la entrega exige que el conductor acepte la cláusula de recepción sin firma', () => {
    expect(validarActa(acta({ clausula: undefined }), ITEMS)).toEqual(['clausula']);
  });

  it('recepción sin firma: vale con motivo; la entrega nunca va sin firma', () => {
    const rec = (sinFirma) => acta({ tipo: 'recepcion', firma: null, clausula: undefined, sinFirma });
    expect(validarActa(rec({ motivo: 'Dejó el auto en la base y no contesta' }), ITEMS)).toEqual([]);
    expect(validarActa(rec({ motivo: '' }), ITEMS)).toEqual(['sin_firma_motivo']);
    expect(validarActa(acta({ firma: null, sinFirma: { motivo: 'No está presente' } }), ITEMS)).toEqual(['sin_firma_entrega']);
  });

  it('la recepción sin firma deja un pendiente con el motivo', () => {
    const p = pendientesDeRecepcion(acta({ tipo: 'recepcion', firma: null, sinFirma: { motivo: 'Auto abandonado en la base' } }), ITEMS);
    expect(p[0].texto).toBe('Recepción sin firma del conductor: Auto abandonado en la base');
  });
});

describe('resumen y pendientes', () => {
  const recepcion = () => {
    const a = acta({ tipo: 'recepcion', luces: true });
    a.fotos.trasera = { sha256: SHA, dano: 'Raya en el parachoques' };
    a.fotos.maleta = { noSePudo: true, motivo: 'Cerradura trabada' };
    a.checklist['Triángulo'] = { estado: 'falta' };
    a.checklist['Limpieza interior'] = { estado: 'danado' };
    a.libres = [{ sha256: SHA, comentario: 'Piquete en el parabrisas' }];
    return a;
  };

  it('R73: el resumen cuenta OK/Falta/Dañado, daños y tomas sin foto', () => {
    const r = resumenActa(recepcion(), ITEMS);
    expect(r.checklist).toEqual({ ok: 1, falta: 1, danado: 1, no_aplica: 0 });
    expect(r.danos).toHaveLength(2);
    expect(r.sinFoto).toEqual([{ toma: 'maleta', motivo: 'Cerradura trabada' }]);
    expect(r).toMatchObject({ km: 18420, luces: true });
  });

  it('R24: la recepción deja un pendiente por daño, faltante y dañado', () => {
    const p = pendientesDeRecepcion(recepcion(), ITEMS).map((x) => x.texto);
    expect(p).toEqual([
      'Daño nuevo (trasera): Raya en el parachoques',
      'Daño nuevo (libre): Piquete en el parabrisas',
      'Falta: Triángulo',
      'Dañado: Limpieza interior',
    ]);
  });

  it('la entrega no deja pendientes', () => {
    expect(pendientesDeRecepcion({ ...recepcion(), tipo: 'entrega' }, ITEMS)).toEqual([]);
  });
});
