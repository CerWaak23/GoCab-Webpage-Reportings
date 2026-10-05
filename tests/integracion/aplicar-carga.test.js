/**
 * Prueba la función aplicar_carga contra el proyecto de Supabase en modo
 * simulación: hace todas las escrituras y las deshace al final, así que no
 * deja datos. Necesita SUPABASE_URL y SUPABASE_SECRET_KEY en .env.local.
 *   npm run test:integracion
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import vehicles from '../fixtures/fleet/vehicles.json';
import drivers from '../fixtures/fleet/drivers.json';
import { analizarExport } from '@/lib/fleet';
import { payloadPara } from '@/lib/carga/payload';

const HOY = '2026-10-01';
let sb;
let antes;

const contar = async (tabla) => (await sb.from(tabla).select('*', { count: 'exact', head: true })).count;

function leerEnv() {
  const env = {};
  for (const l of fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

async function simular(tipo, filas) {
  const datos = payloadPara(analizarExport(filas, {}, HOY));
  const { error } = await sb.rpc('aplicar_carga', {
    p_tipo: tipo, p_datos: datos, p_carga_id: null, p_hoy: HOY, p_simular: true,
  });
  expect(error?.message, JSON.stringify(error)).toBe('SIMULACION');
  return JSON.parse(error.details);
}

beforeAll(async () => {
  const env = leerEnv();
  sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  // La base ya tiene datos reales: se compara contra lo que había antes.
  antes = { autos: await contar('autos'), conductores: await contar('conductores'), asignaciones: await contar('asignaciones') };
});

// Los datos de prueba están anonimizados (RUT, nombres y patentes inventados),
// así que contra la base real son todos nuevos.
describe('aplicar_carga (simulación, sin dejar datos)', () => {
  it('drivers: crea los 95 conductores de prueba', async () => {
    const r = await simular('drivers', drivers);
    expect(r.conductores_nuevos).toBe(95);
    expect(r.conductores_actualizados).toBe(0);
  });

  it('vehicles: crea los autos y abre una asignación por auto con conductor', async () => {
    const r = await simular('vehicles', vehicles);
    expect(r.autos_nuevos).toBe(114);
    expect(r.asignaciones_abiertas).toBe(95);
    expect(r.asignaciones_cerradas).toBe(0);
    // Solo la primera carga marca las asignaciones como preexistentes.
    expect(r.primera_carga).toBe(antes.asignaciones === 0);
    expect(r.reemplazos).toBe(0);
  });

  it('la simulación no dejó nada en la base', async () => {
    expect(await contar('autos')).toBe(antes.autos);
    expect(await contar('conductores')).toBe(antes.conductores);
    expect(await contar('asignaciones')).toBe(antes.asignaciones);
  });

  it('un tipo desconocido se rechaza sin escribir', async () => {
    const { error } = await sb.rpc('aplicar_carga', {
      p_tipo: 'otro', p_datos: [], p_carga_id: '00000000-0000-0000-0000-000000000000', p_hoy: HOY, p_simular: true,
    });
    expect(error.message).toMatch(/Tipo de carga desconocido/);
  });

  it('el navegador (clave publicable) no puede ejecutar la función', async () => {
    const env = leerEnv();
    const nav = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    const { error } = await nav.rpc('aplicar_carga', {
      p_tipo: 'drivers', p_datos: [], p_carga_id: '00000000-0000-0000-0000-000000000000', p_hoy: HOY, p_simular: true,
    });
    expect(error).not.toBe(null);
    expect(error.message).not.toBe('SIMULACION');
  });
});
