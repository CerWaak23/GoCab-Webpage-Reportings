import { describe, it, expect } from 'vitest';
import { LANGS, IDIOMAS, traducir } from '@/lib/i18n/dict';
import { puedeVerSeccion } from '@/lib/i18n/secciones';

describe('diccionario es/en/ru', () => {
  it('tiene exactamente los tres idiomas', () => {
    expect(IDIOMAS).toEqual(['es', 'en', 'ru']);
    expect(Object.keys(LANGS).sort()).toEqual(['en', 'es', 'ru']);
  });

  it('toda clave existe en los tres idiomas y con el mismo tipo', () => {
    const claves = new Set(IDIOMAS.flatMap((l) => Object.keys(LANGS[l])));
    for (const k of claves) {
      for (const l of IDIOMAS) {
        expect(LANGS[l][k], `${l}.${k}`).toBeDefined();
        expect(typeof LANGS[l][k], `${l}.${k}`).toBe(typeof LANGS.es[k]);
      }
    }
  });

  it('ningún texto queda vacío', () => {
    for (const l of IDIOMAS) for (const [k, v] of Object.entries(LANGS[l])) {
      if (typeof v === 'string') expect(v.trim(), `${l}.${k}`).not.toBe('');
    }
  });

  it('incluye las secciones nuevas', () => {
    for (const l of IDIOMAS) {
      for (const k of ['historial_title', 'historial_sub', 'carga_title', 'carga_sub', 'en_construccion']) {
        expect(LANGS[l][k], `${l}.${k}`).toBeTruthy();
      }
    }
  });

  it('traducir cae a español si el idioma o la clave no existen', () => {
    expect(traducir('xx', 'historial_title')).toBe(LANGS.es.historial_title);
    expect(traducir('ru', 'historial_title')).toBe(LANGS.ru.historial_title);
    expect(traducir('en', 'no_existe')).toBe('no_existe');
  });

  it('las funciones de saludo reciben el nombre', () => {
    for (const l of IDIOMAS) expect(LANGS[l].greeting('Ana')).toContain('Ana');
  });
});

describe('qué secciones ve cada rol', () => {
  it('el encargado de taller no ve Carga de datos pero sí el Historial', () => {
    expect(puedeVerSeccion('Encargado de taller', 'carga')).toBe(false);
    expect(puedeVerSeccion('Encargado de taller', 'historial')).toBe(true);
  });

  it('gerencia y coordinadores ven ambas', () => {
    for (const rol of ['Gerente de Operaciones', 'Coordinador de Flota']) {
      expect(puedeVerSeccion(rol, 'carga')).toBe(true);
      expect(puedeVerSeccion(rol, 'historial')).toBe(true);
    }
  });

  it('una sección desconocida no se muestra', () => {
    expect(puedeVerSeccion('Gerente de Operaciones', 'otra')).toBe(false);
  });
});
