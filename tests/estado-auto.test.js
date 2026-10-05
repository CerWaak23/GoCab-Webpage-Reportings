import { describe, it, expect } from 'vitest';
import { estadoAuto, revision, documentosPorVencer, contarEstados } from '@/lib/historial/estado';
import { puedeVerArchivo, registraAcceso, veContactoConductor } from '@/lib/historial/permisos';

const HOY = '2026-10-20';
const auto = { patente: 'KLMN88', estado_fleet: 'working', fotos_ingreso_pendientes: false };
const juan = 'c-juan';

describe('estado del auto', () => {
  it('AE6: asignado en Fleet ayer sin acta de entrega → entrega pendiente', () => {
    const vigente = { conductor_id: juan, desde: '2026-10-19', origen: 'fleet' };
    expect(estadoAuto({ auto, vigente, hoy: HOY }).estado).toBe('entrega_pendiente');
  });

  it('asignado hace 20 días sin acta → falta levantamiento', () => {
    const vigente = { conductor_id: juan, desde: '2026-09-30', origen: 'fleet' };
    expect(estadoAuto({ auto, vigente, hoy: HOY }).estado).toBe('falta_levantamiento');
  });

  it('flota que ya circulaba al partir GoBills → falta levantamiento', () => {
    const vigente = { conductor_id: juan, desde: HOY, origen: 'preexistente' };
    expect(estadoAuto({ auto, vigente, hoy: HOY }).estado).toBe('falta_levantamiento');
  });

  it('con acta de entrega a ese conductor → con conductor', () => {
    const vigente = { conductor_id: juan, desde: '2026-10-19', origen: 'fleet' };
    const eventos = [{ tipo: 'entrega', fecha: '2026-10-18T15:00:00Z', conductor_id: juan }];
    expect(estadoAuto({ auto, vigente, eventos, hoy: HOY }).estado).toBe('con_conductor');
  });

  it('un acta de entrega a otro conductor no cuenta', () => {
    const vigente = { conductor_id: juan, desde: '2026-10-19', origen: 'fleet' };
    const eventos = [{ tipo: 'entrega', fecha: '2026-10-01T15:00:00Z', conductor_id: 'otro' }];
    expect(estadoAuto({ auto, vigente, eventos, hoy: HOY }).estado).toBe('entrega_pendiente');
  });

  it('levantamiento hecho después de la asignación → con conductor', () => {
    const vigente = { conductor_id: juan, desde: '2026-10-05', origen: 'preexistente' };
    const eventos = [{ tipo: 'levantamiento', fecha: '2026-10-07T10:00:00Z', conductor_id: juan }];
    expect(estadoAuto({ auto, vigente, eventos, hoy: HOY }).estado).toBe('con_conductor');
  });

  it('sin conductor → disponible; nuevo sin fotos → fotos de ingreso pendientes', () => {
    expect(estadoAuto({ auto, hoy: HOY }).estado).toBe('disponible');
    expect(estadoAuto({ auto: { ...auto, fotos_ingreso_pendientes: true }, hoy: HOY }).estado).toBe('fotos_ingreso');
  });

  it('R60: Fleet en mantención sin ingreso a taller → sin ingreso registrado', () => {
    expect(estadoAuto({ auto: { ...auto, estado_fleet: 'maintenance' }, hoy: HOY }).estado).toBe('sin_ingreso_taller');
  });

  it('con ingreso a taller abierto → en taller; con salida → vuelve a su estado', () => {
    const a = { ...auto, estado_fleet: 'maintenance' };
    expect(estadoAuto({ auto: a, eventos: [{ tipo: 'taller', fecha: '2026-10-15', detalle: {} }], hoy: HOY }).estado).toBe('en_taller');
    expect(estadoAuto({ auto, eventos: [{ tipo: 'taller', fecha: '2026-10-15', detalle: { salida: '2026-10-18' } }], hoy: HOY }).estado).toBe('disponible');
  });

  it('siniestro abierto con el auto sin circular es lo más urgente', () => {
    const eventos = [
      { tipo: 'siniestro', fecha: '2026-10-10', detalle: { circula: false } },
      { tipo: 'taller', fecha: '2026-10-11', detalle: {} },
    ];
    expect(estadoAuto({ auto, eventos, hoy: HOY }).estado).toBe('siniestro');
  });

  it('pérdida total → baja', () => {
    expect(estadoAuto({ auto: { ...auto, estado_fleet: 'total_loss' }, hoy: HOY }).estado).toBe('baja');
  });

  it('auto de reemplazo y pendientes van como alertas', () => {
    const vigente = { conductor_id: juan, desde: HOY, origen: 'fleet', reemplazo: true, reemplaza_patente: 'VVCG35' };
    const { alertas } = estadoAuto({ auto, vigente, pendientes: 2, hoy: HOY });
    expect(alertas).toContainEqual({ tipo: 'reemplazo', patente: 'VVCG35' });
    expect(alertas).toContainEqual({ tipo: 'pendientes', cantidad: 2 });
  });
});

describe('revisión periódica', () => {
  it('última revisión hace 31 días con plazo 30 → vencida por 1 día', () => {
    const r = revision([{ tipo: 'revision', fecha: '2026-09-19T12:00:00Z' }], HOY, 30);
    expect(r).toMatchObject({ vencida: true, diasVencida: 1, vence: '2026-10-19' });
  });
  it('cuenta desde la última entrega, levantamiento o revisión', () => {
    const r = revision([
      { tipo: 'entrega', fecha: '2026-08-01' },
      { tipo: 'levantamiento', fecha: '2026-10-10' },
      { tipo: 'siniestro', fecha: '2026-10-15' },
    ], HOY, 30);
    expect(r).toMatchObject({ desde: '2026-10-10', vencida: false });
  });
  it('la alerta de revisión vencida solo aplica con conductor', () => {
    const eventos = [{ tipo: 'revision', fecha: '2026-08-01' }];
    const vigente = { conductor_id: juan, desde: '2026-07-01', origen: 'fleet' };
    expect(estadoAuto({ auto, vigente, eventos, hoy: HOY }).alertas.map((a) => a.tipo)).toContain('revision_vencida');
    expect(estadoAuto({ auto, eventos, hoy: HOY }).alertas).toEqual([]);
  });
});

describe('documentos por vencer', () => {
  it('un permiso que vence en 19 días aparece marcado; uno a 60 días no', () => {
    const docs = documentosPorVencer([
      { clase: 'documento', vence: '2026-11-08', metadatos: { tipo: 'permiso' } },
      { clase: 'documento', vence: '2026-12-19', metadatos: { tipo: 'soap' } },
    ], HOY);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ dias: 19 });
  });
  it('un documento vencido sale como vencido', () => {
    const { alertas } = estadoAuto({ auto, archivos: [{ clase: 'documento', vence: '2026-10-01', metadatos: { tipo: 'soap' } }], hoy: HOY });
    expect(alertas).toContainEqual({ tipo: 'documento_vencido', dias: -19, documento: 'soap' });
  });
});

describe('conteo por estado', () => {
  it('cuenta cada estado y deja en 0 los que no hay', () => {
    const c = contarEstados([{ estado: 'disponible' }, { estado: 'disponible' }, { estado: 'en_taller' }]);
    expect(c).toMatchObject({ disponible: 2, en_taller: 1, siniestro: 0 });
  });
});

describe('quién ve qué', () => {
  const taller = { role: 'Encargado de taller' };
  const coord = { role: 'Coordinador de Flota' };
  it('un encargado de taller que pide una cédula recibe 403', () => {
    expect(puedeVerArchivo(taller, 'cedula')).toBe(403);
    expect(puedeVerArchivo(taller, 'foto')).toBe(null);
  });
  it('un coordinador ve la cédula y el acceso queda registrado', () => {
    expect(puedeVerArchivo(coord, 'cedula')).toBe(null);
    expect(registraAcceso('cedula')).toBe(true);
    expect(registraAcceso('foto')).toBe(false);
  });
  it('sin sesión: 401', () => expect(puedeVerArchivo(null, 'foto')).toBe(401));
  it('el taller no ve RUT ni teléfono del conductor', () => {
    expect(veContactoConductor(taller)).toBe(false);
    expect(veContactoConductor(coord)).toBe(true);
  });
});
