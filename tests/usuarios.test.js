import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usuarioDesdeFila, buscarUsuario } from '@/lib/usuarios';
import { puedeVerSeccion } from '@/lib/i18n/secciones';

describe('usuario desde la tabla', () => {
  it('gerencia y admin son gerentes; coordinador no', () => {
    expect(usuarioDesdeFila({ email: 'a@gocab.io', nombre: 'A', rol: 'gerencia' }).isManager).toBe(true);
    expect(usuarioDesdeFila({ email: 'a@gocab.io', nombre: 'A', rol: 'admin' }).isManager).toBe(true);
    expect(usuarioDesdeFila({ email: 'a@gocab.io', nombre: 'A', rol: 'coordinador' }).isManager).toBe(false);
  });
  it('muestra el cargo, y sin cargo el rol', () => {
    expect(usuarioDesdeFila({ email: 'a@gocab.io', nombre: 'A', rol: 'gerencia', cargo: 'Gerente de Operaciones' }).role).toBe('Gerente de Operaciones');
    expect(usuarioDesdeFila({ email: 'a@gocab.io', nombre: 'A', rol: 'coordinador' }).role).toBe('Coordinador de Flota');
  });
  it('un usuario de taller no ve Carga de datos aunque su cargo no diga taller', () => {
    const u = usuarioDesdeFila({ email: 'a@gocab.io', nombre: 'A', rol: 'taller', cargo: 'Mecánico' });
    expect(puedeVerSeccion(u.role, 'carga')).toBe(false);
    expect(puedeVerSeccion(u.role, 'despedidos')).toBe(false);
  });
});

describe('buscar usuario en Supabase', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_x';
  });
  const responder = (filas, ok = true) => vi.fn(async () => ({ ok, json: async () => filas }));

  it('activo entra', async () => {
    global.fetch = responder([{ email: 'activo@gocab.io', nombre: 'Activo', rol: 'coordinador', activo: true }]);
    expect((await buscarUsuario('Activo@gocab.io')).usuario?.name).toBe('Activo');
  });
  it('desactivado o inexistente no entra', async () => {
    global.fetch = responder([{ email: 'baja@gocab.io', nombre: 'Baja', rol: 'coordinador', activo: false }]);
    expect(await buscarUsuario('baja@gocab.io')).toEqual({ ok: true, usuario: null });
    global.fetch = responder([]);
    expect(await buscarUsuario('nadie@gocab.io')).toEqual({ ok: true, usuario: null });
  });
  it('si la base no responde lo dice, sin inventar un usuario', async () => {
    global.fetch = responder([], false);
    expect(await buscarUsuario('caido@gocab.io')).toEqual({ ok: false });
    global.fetch = vi.fn(async () => { throw new Error('red'); });
    expect(await buscarUsuario('caido2@gocab.io')).toEqual({ ok: false });
  });
});
