import { describe, it, expect } from 'vitest';
import { TOMAS_CONDUCTOR, tipoDeFotos, validarEnvio, rutaFoto } from '@/lib/historial/tomas';
import { dimensionesDestino, sha256Hex } from '@/lib/historial/imagen';

const SHA = 'a'.repeat(64);
const completo = () => ({
  km: 45210,
  fotos: Object.fromEntries(TOMAS_CONDUCTOR.map((t) => [t, { ruta: `X/${t}.jpg`, sha256: SHA }])),
});

describe('levantamiento o revisión', () => {
  const juan = 'c-juan';
  it('sin acta del conductor desde la asignación → levantamiento', () => {
    expect(tipoDeFotos([], juan, '2026-10-05')).toBe('levantamiento');
  });
  it('con levantamiento o entrega propios desde la asignación → revisión', () => {
    expect(tipoDeFotos([{ tipo: 'levantamiento', conductor_id: juan, fecha: '2026-10-06T10:00:00Z' }], juan, '2026-10-05')).toBe('revision');
    expect(tipoDeFotos([{ tipo: 'entrega', conductor_id: juan, fecha: '2026-10-05T09:00:00Z' }], juan, '2026-10-05')).toBe('revision');
  });
  it('el acta de otro conductor o anterior a la asignación no cuenta', () => {
    expect(tipoDeFotos([{ tipo: 'levantamiento', conductor_id: 'otro', fecha: '2026-10-06' }], juan, '2026-10-05')).toBe('levantamiento');
    expect(tipoDeFotos([{ tipo: 'entrega', conductor_id: juan, fecha: '2026-09-01' }], juan, '2026-10-05')).toBe('levantamiento');
  });
});

describe('validar el envío', () => {
  it('las 5 tomas con foto y el km → sin errores', () => {
    expect(validarEnvio(completo())).toEqual([]);
  });
  it('falta una toma', () => {
    const e = completo();
    delete e.fotos.trasera;
    expect(validarEnvio(e)).toEqual(['falta_trasera']);
  });
  it('"no se pudo tomar" exige motivo (R70)', () => {
    const e = completo();
    e.fotos.lateral_izquierdo = { noSePudo: true, motivo: '' };
    expect(validarEnvio(e)).toEqual(['motivo_lateral_izquierdo']);
    e.fotos.lateral_izquierdo = { noSePudo: true, motivo: 'Pegado a una pared' };
    expect(validarEnvio(e)).toEqual([]);
  });
  it('una foto sin huella válida no se acepta', () => {
    const e = completo();
    e.fotos.frente.sha256 = 'xyz';
    expect(validarEnvio(e)).toEqual(['foto_frente']);
  });
  it('km obligatorio, entero y razonable', () => {
    for (const km of [undefined, '', -1, 12.5, 5_000_000]) {
      expect(validarEnvio({ ...completo(), km })).toContain('km');
    }
    expect(validarEnvio({ ...completo(), km: 0 })).toEqual([]);
  });
});

describe('fotos', () => {
  it('una imagen de 4000 px queda en 1600 px de lado mayor, con su proporción', () => {
    expect(dimensionesDestino(4000, 3000)).toEqual({ ancho: 1600, alto: 1200 });
    expect(dimensionesDestino(3000, 4000)).toEqual({ ancho: 1200, alto: 1600 });
  });
  it('una imagen chica no se agranda', () => {
    expect(dimensionesDestino(800, 600)).toEqual({ ancho: 800, alto: 600 });
  });
  it('el hash de la misma imagen es estable y cambia si cambia un byte', async () => {
    const a = new Uint8Array([1, 2, 3, 4]).buffer;
    const b = new Uint8Array([1, 2, 3, 5]).buffer;
    expect(await sha256Hex(a)).toBe(await sha256Hex(a.slice(0)));
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
    expect(await sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('la ruta de la foto no lleva datos personales', () => {
    const r = rutaFoto('VVCG25', '123e4567-e89b-12d3-a456-426614174000', 'frente', new Date('2026-10-05T12:00:00Z'));
    expect(r).toBe('VVCG25/2026-10/123e4567-e89b-12d3-a456-426614174000-frente.jpg');
  });
});
