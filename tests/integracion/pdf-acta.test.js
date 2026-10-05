/**
 * PDF del acta con fotos reales: las del levantamiento de prueba de FAKECAR
 * (auto ficticio), repetidas hasta 20. No escribe nada en la base.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { generarPdfActa } from '@/lib/historial/pdf';
import { TOMAS_PROTOCOLO } from '@/lib/historial/actas';

let fotos = [];

beforeAll(async () => {
  const env = Object.fromEntries(fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]));
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data } = await sb.from('archivos').select('ruta').eq('patente', 'FAKECAR').eq('clase', 'foto').limit(5);
  const bajadas = [];
  for (const a of data) {
    const { data: b } = await sb.storage.from('fotos').download(a.ruta);
    bajadas.push(Buffer.from(await b.arrayBuffer()));
  }
  fotos = Array.from({ length: 20 }, (_, i) => ({
    toma: TOMAS_PROTOCOLO[i % TOMAS_PROTOCOLO.length],
    metadatos: i === 1 ? { dano: 'Raya en el parachoques' } : {},
    datos: bajadas[i % bajadas.length],
  }));
}, 60000);

describe('PDF del acta', () => {
  it('un acta con 20 fotos se genera en menos de 60 s y pesa menos de 5 MB', async () => {
    expect(fotos.length).toBe(20);
    const inicio = Date.now();
    const pdf = await generarPdfActa({
      evento: {
        patente: 'FAKECAR', tipo: 'recepcion', fecha: '2026-10-05T18:00:00Z', usuario_email: 'prueba@gocab.io',
        checklist_version: 1, version_aviso: 'borrador-2026-10-05',
        detalle: { km: 18420, luces: true, checklist: { Triángulo: { estado: 'falta' } }, motivos: { maleta: 'Cerradura trabada' } },
        conductores: { nombre: 'Joy Varela (prueba)', rut: '11.111.111-1' },
        autos: { marca: 'Prueba', modelo: 'Ficticio' },
      },
      fotos,
      firma: null,
      checklist: { version: 1, items: [{ grupo: 'Equipamiento', items: ['Triángulo', 'Extintor'] }] },
    });
    const segundos = (Date.now() - inicio) / 1000;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(segundos).toBeLessThan(60);
    expect(pdf.length).toBeLessThan(5 * 1024 * 1024);
    console.log(`PDF: ${(pdf.length / 1024).toFixed(0)} KB en ${segundos.toFixed(1)} s`);
  }, 90000);
});
