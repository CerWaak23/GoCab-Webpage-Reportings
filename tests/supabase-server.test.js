import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL = { ...process.env };

describe('cliente de Supabase del servidor', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...ORIGINAL }; });

  it('falla con un mensaje claro si falta la clave secreta', async () => {
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
    delete process.env.SUPABASE_SECRET_KEY;
    const { supabaseServidor } = await import('@/lib/supabase/server');
    expect(() => supabaseServidor()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('falla si falta la URL del proyecto', async () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_x';
    const { supabaseServidor } = await import('@/lib/supabase/server');
    expect(() => supabaseServidor()).toThrow(/SUPABASE_URL/);
  });

  it('rechaza una clave publicable usada como secreta', async () => {
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sb_publishable_x';
    const { supabaseServidor } = await import('@/lib/supabase/server');
    expect(() => supabaseServidor()).toThrow(/secreta/);
  });

  it('crea un único cliente reutilizable con las variables correctas', async () => {
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_x';
    const { supabaseServidor } = await import('@/lib/supabase/server');
    const a = supabaseServidor();
    expect(a).toBe(supabaseServidor());
    expect(typeof a.from).toBe('function');
  });
});

describe('migración base', () => {
  it('activa RLS en todas las tablas que crea y no define políticas', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync(new URL('../supabase/migrations/0001_base.sql', import.meta.url), 'utf8');
    const tablas = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]);
    expect(tablas.length).toBeGreaterThan(5);
    for (const t of tablas) {
      expect(sql, `RLS para ${t}`).toMatch(new RegExp(`alter table public\\.${t} enable row level security`, 'i'));
    }
    expect(sql).not.toMatch(/create policy/i);
  });

  it('crea los buckets privados con tipos y tamaño máximo', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync(new URL('../supabase/migrations/0001_base.sql', import.meta.url), 'utf8');
    for (const b of ['fotos', 'documentos', 'actas', 'cargas']) expect(sql).toMatch(new RegExp(`'${b}', '${b}', false`));
  });

  it('el registro de accesos no se puede modificar ni borrar', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync(new URL('../supabase/migrations/0001_base.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/revoke update, delete on public\.registro_accesos/i);
    expect(sql).toMatch(/before update or delete on public\.registro_accesos/i);
    // el revoke debe ir después del grant general al servidor, o el grant lo anula
    expect(sql.search(/revoke update, delete on public\.registro_accesos/i))
      .toBeGreaterThan(sql.search(/grant select, insert, update, delete on all tables in schema public to service_role/i));
  });

  it('solo el servidor recibe permisos; el navegador no', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync(new URL('../supabase/migrations/0001_base.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/grant select, insert, update, delete on all tables in schema public to service_role/i);
    expect(sql).not.toMatch(/grant [^;]* to (anon|authenticated)/i);
    expect(sql).toMatch(/revoke all on all tables in schema public from anon, authenticated/i);
  });
});
