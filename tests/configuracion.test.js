import { describe, it, expect } from 'vitest';
import { validarChecklist, mismaChecklist, validarAjustes, actaEsDelConductor, textoNotaValido } from '@/lib/historial/configuracion';

describe('checklist editable (R10)', () => {
  it('limpia espacios y quita elementos vacíos', () => {
    const r = validarChecklist([{ grupo: ' Equipamiento ', items: ['Triángulo', '  Extintor  ', ''] }]);
    expect(r).toEqual({ grupos: [{ grupo: 'Equipamiento', items: ['Triángulo', 'Extintor'] }] });
  });
  it('rechaza grupos sin nombre o sin elementos', () => {
    expect(validarChecklist([{ grupo: '', items: ['A'] }]).error).toBe('grupo_sin_nombre');
    expect(validarChecklist([{ grupo: 'G', items: [' '] }]).error).toBe('grupo_vacio');
    expect(validarChecklist([]).error).toBe('vacia');
  });
  it('rechaza elementos repetidos, aunque cambien mayúsculas', () => {
    expect(validarChecklist([{ grupo: 'A', items: ['TAG'] }, { grupo: 'B', items: ['tag'] }]).error).toBe('repetido');
  });
  it('detecta si no hubo cambios', () => {
    const a = [{ grupo: 'A', items: ['x'] }];
    expect(mismaChecklist(a, [{ grupo: 'A', items: ['x'] }])).toBe(true);
    expect(mismaChecklist(a, [{ grupo: 'A', items: ['y'] }])).toBe(false);
  });
});

describe('ajustes', () => {
  it('revisión entre 7 y 180 días', () => {
    expect(validarAjustes({ revision_dias: '45' })).toEqual({ valores: { revision_dias: 45 } });
    expect(validarAjustes({ revision_dias: 3 }).error).toBe('revision_dias');
  });
  it('RUT de la empresa válido y formateado', () => {
    expect(validarAjustes({ rut_empresa: '781642088' })).toEqual({ valores: { rut_empresa: '78.164.208-8' } });
    expect(validarAjustes({ rut_empresa: '78.164.208-1' }).error).toBe('rut_empresa');
  });
  it('teléfono de asistencia', () => {
    expect(validarAjustes({ telefono_asistencia_sura: '600 411 1000' }).valores.telefono_asistencia_sura).toBe('600 411 1000');
    expect(validarAjustes({ telefono_asistencia_sura: 'llamar' }).error).toBe('telefono_asistencia_sura');
  });
  it('no deja tocar claves desconocidas', () => {
    expect(validarAjustes({ otra: 1 }).error).toBe('otra');
  });
});

describe('actas del conductor y notas', () => {
  it('un conductor no puede pedir el acta de otro (403)', () => {
    expect(actaEsDelConductor({ conductor_id: 'a' }, 'a')).toBe(true);
    expect(actaEsDelConductor({ conductor_id: 'a' }, 'b')).toBe(false);
    expect(actaEsDelConductor({ conductor_id: 'a' }, null)).toBe(false);
  });
  it('AE5: la nota de corrección necesita texto', () => {
    expect(textoNotaValido('Km correcto: 18.240')).toBe(true);
    expect(textoNotaValido('  ')).toBe(false);
  });
});
