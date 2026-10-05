import { describe, it, expect } from 'vitest';
import { limpiarRut, rutValido, formatearRut } from '@/lib/rut';
import { normalizarPatente } from '@/lib/patente';

describe('RUT', () => {
  it('normaliza los formatos que trae Fleet al mismo valor', () => {
    // 15.332.823-4 es un RUT válido; Fleet lo trae de tres formas distintas
    expect(formatearRut('153328234')).toBe('15.332.823-4');
    expect(formatearRut('15.332.823-4')).toBe('15.332.823-4');
    expect(formatearRut('15332823-4')).toBe('15.332.823-4');
    expect(formatearRut(' 15.332.823-4 ')).toBe('15.332.823-4');
  });

  it('acepta K mayúscula o minúscula como dígito verificador', () => {
    expect(rutValido('16.004.731-k')).toBe(rutValido('16004731K'));
    expect(limpiarRut('16.004.731-k')).toBe('16004731K');
  });

  it('valida el dígito verificador', () => {
    expect(rutValido('7.513.230-1')).toBe(true);
    expect(rutValido('17740563-9')).toBe(true);
    expect(rutValido('12345678-0')).toBe(false);
  });

  it('rechaza valores vacíos o demasiado cortos', () => {
    expect(rutValido('')).toBe(false);
    expect(rutValido(null)).toBe(false);
    expect(rutValido('1-9')).toBe(false);
    expect(formatearRut('abc')).toBe(null);
  });

  it('no formatea un RUT con dígito verificador inválido', () => {
    expect(formatearRut('12345678-0')).toBe(null);
  });
});

describe('patente', () => {
  it('usa una sola regla: mayúsculas y solo letras y números', () => {
    expect(normalizarPatente('vzss-46')).toBe('VZSS46');
    expect(normalizarPatente(' VZ SS 46 ')).toBe('VZSS46');
    expect(normalizarPatente('BAIC Eu5 (VZST20)')).toBe('BAICEU5VZST20');
    expect(normalizarPatente(null)).toBe('');
  });
});
