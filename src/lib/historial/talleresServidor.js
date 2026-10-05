import 'server-only';
import { createHash } from 'node:crypto';
import { supabaseServidor } from '@/lib/supabase/server';
import { normalizarPatente } from '@/lib/patente';
import {
  validarIngreso, validarActualizacion, validarSalida, escalamiento, diasEnTaller, gastoDeSalida, reemplazosSinTaller,
} from './taller';
import { UID } from './tomas';

function revisar(...rs) {
  for (const r of rs) if (r.error) throw new Error(r.error.message);
}

const pasoDe = (e, hoy) => {
  const d = e.detalle || {};
  const act = [...(e.taller_actualizaciones || [])].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const ultima = act[act.length - 1] || null;
  return {
    id: e.id,
    patente: e.patente,
    auto: [e.autos?.marca, e.autos?.modelo].filter(Boolean).join(' '),
    conductor: e.conductores?.nombre ?? null,
    taller: d.taller,
    motivo: d.motivo,
    paga: d.paga,
    ot: d.ot || null,
    km: d.km ?? null,
    descripcion: d.descripcion,
    ingreso: d.ingreso,
    salida: d.salida || null,
    salidaEstimada: d.salidaEstimada || null,
    monto: d.monto ?? null,
    factura: d.factura || null,
    dias: diasEnTaller(d.ingreso, d.salida, hoy),
    estado: [...act].reverse().find((a) => a.estado)?.estado || null,
    ultimaActualizacion: ultima?.fecha || null,
    escalar: d.salida ? null : escalamiento({ ingreso: d.ingreso, ultimaActualizacion: ultima?.fecha }, hoy),
    actualizaciones: act,
    registradoPor: e.usuario_email,
  };
};

const SELECCION = 'id, patente, fecha, usuario_email, detalle, autos(marca, modelo), conductores(nombre), taller_actualizaciones(id, fecha, autor_email, texto, estado, monto)';

/** Todo lo que muestra la sección Talleres. */
export async function vistaTalleres(hoy) {
  const sb = supabaseServidor();
  const [catalogo, abiertos, cerrados, mantencion, reemplazos] = await Promise.all([
    sb.from('talleres').select('id, nombre, marca, para, activo').order('nombre'),
    sb.from('eventos').select(SELECCION).eq('tipo', 'taller').is('detalle->>salida', null),
    sb.from('eventos').select(SELECCION).eq('tipo', 'taller').not('detalle->>salida', 'is', null)
      .order('fecha', { ascending: false }).limit(100),
    sb.from('autos').select('patente, marca, modelo').eq('estado_fleet', 'maintenance'),
    sb.from('asignaciones').select('patente, reemplaza_patente, desde, conductores(nombre)').is('hasta', null).eq('reemplazo', true),
  ]);
  revisar(catalogo, abiertos, cerrados, mantencion, reemplazos);

  const enTaller = abiertos.data.map((e) => e.patente);
  const reemplazoDe = new Map(reemplazos.data.map((r) => [r.reemplaza_patente, { patente: r.patente, conductor: r.conductores?.nombre ?? null }]));
  const pasos = abiertos.data.map((e) => ({ ...pasoDe(e, hoy), reemplazo: reemplazoDe.get(e.patente) || null }))
    .sort((a, b) => (b.escalar?.dias ?? -1) - (a.escalar?.dias ?? -1) || b.dias - a.dias);

  return {
    hoy,
    catalogo: catalogo.data,
    abiertos: pasos,
    // R60: Fleet lo tiene en mantención y en GoBills no hay ingreso.
    sinIngreso: mantencion.data.filter((a) => !enTaller.includes(a.patente))
      .map((a) => ({ patente: a.patente, auto: [a.marca, a.modelo].filter(Boolean).join(' '), reemplazo: reemplazoDe.get(a.patente) || null })),
    reemplazosSinTaller: reemplazosSinTaller(reemplazos.data, enTaller)
      .map((r) => ({ patente: r.patente, reemplazaPatente: r.reemplaza_patente, conductor: r.conductores?.nombre ?? null, desde: r.desde })),
    historial: cerrados.data.map((e) => pasoDe(e, hoy)),
  };
}

async function eventoAbierto(sb, eventoId) {
  const { data } = await sb.from('eventos').select('id, patente, detalle').eq('id', eventoId).eq('tipo', 'taller').maybeSingle();
  return data && !data.detalle?.salida ? data : null;
}

/** R56: ingreso a taller. El conductor del evento es el que tenía el auto. */
export async function registrarIngreso(usuario, datos) {
  const errores = validarIngreso(datos);
  const patente = normalizarPatente(datos?.patente);
  if (!patente) errores.push('patente');
  if (errores.length) return { error: 'datos', errores, status: 400 };

  const sb = supabaseServidor();
  const [{ data: auto }, { data: taller }, { data: asig }] = await Promise.all([
    sb.from('autos').select('patente').eq('patente', patente).maybeSingle(),
    sb.from('talleres').select('id, nombre').eq('id', datos.tallerId).maybeSingle(),
    sb.from('asignaciones').select('conductor_id, hasta').eq('patente', patente).order('desde', { ascending: false }).limit(1),
  ]);
  if (!auto) return { error: 'no_existe', status: 404 };
  if (!taller) return { error: 'datos', errores: ['taller'], status: 400 };

  const ingreso = new Date(datos.ingreso).toISOString();
  const { data, error } = await sb.from('eventos').insert({
    patente,
    conductor_id: asig?.[0]?.conductor_id ?? null,
    tipo: 'taller',
    fecha: ingreso,
    usuario_email: usuario.email,
    detalle: {
      tallerId: taller.id,
      taller: taller.nombre,
      motivo: datos.motivo,
      paga: datos.paga,
      ot: String(datos.ot || '').trim().slice(0, 60) || null,
      km: datos.km === '' || datos.km == null ? null : Number(datos.km),
      descripcion: String(datos.descripcion).trim().slice(0, 1000),
      ingreso,
      salidaEstimada: datos.salidaEstimada ? String(datos.salidaEstimada).slice(0, 10) : null,
    },
  }).select('id').single();
  if (error) {
    if (error.code === '23505') return { error: 'ya_en_taller', status: 409 };
    throw new Error(error.message);
  }
  return { ok: true, id: data.id };
}

/** R57: actualización del encargado (solo se agregan). */
export async function registrarActualizacion(usuario, datos) {
  const errores = validarActualizacion(datos);
  if (errores.length) return { error: 'datos', errores, status: 400 };
  const sb = supabaseServidor();
  const ev = await eventoAbierto(sb, datos.eventoId);
  if (!ev) return { error: 'cerrado', status: 409 };
  const estimada = datos.salidaEstimada ? String(datos.salidaEstimada).slice(0, 10) : null;
  if (estimada && estimada !== ev.detalle.salidaEstimada) {
    // La fecha vigente queda en el paso; el cambio queda escrito en la actualización.
    const { error: e1 } = await sb.from('eventos').update({ detalle: { ...ev.detalle, salidaEstimada: estimada } }).eq('id', ev.id);
    if (e1) throw new Error(e1.message);
  }
  const { data, error } = await sb.from('taller_actualizaciones').insert({
    evento_id: datos.eventoId,
    autor_email: usuario.email,
    texto: (String(datos.texto).trim() + (estimada && estimada !== ev.detalle.salidaEstimada ? ` (salida estimada: ${estimada.split('-').reverse().join('/')})` : '')).slice(0, 1100),
    estado: datos.estado || null,
    monto: datos.monto === '' || datos.monto == null ? null : Number(datos.monto),
  }).select('id, fecha, autor_email, texto, estado, monto').single();
  if (error) throw new Error(error.message);
  return { ok: true, actualizacion: data };
}

/** URL firmada para subir la factura del taller (PDF o foto). */
export async function urlFactura({ eventoId, uid, ext }) {
  if (!UID.test(uid || '') || !['pdf', 'jpg', 'png'].includes(ext)) return { error: 'datos' };
  const sb = supabaseServidor();
  const ev = await eventoAbierto(sb, eventoId);
  if (!ev) return { error: 'cerrado' };
  const ruta = `facturas/${ev.patente}/${uid}.${ext}`;
  const { data, error } = await sb.storage.from('documentos').createSignedUploadUrl(ruta, { upsert: true });
  if (error) throw new Error(error.message);
  return { ruta, token: data.token };
}

/**
 * R59: salida del taller. Calcula los días, guarda la factura y, si paga
 * GoCab, deja el gasto en el detalle (la sección Gastos los suma).
 */
export async function registrarSalida(usuario, datos) {
  const sb = supabaseServidor();
  const ev = await eventoAbierto(sb, datos?.eventoId);
  if (!ev) return { error: 'cerrado', status: 409 };
  const errores = validarSalida(datos, ev.detalle.ingreso);
  if (datos.archivo && !String(datos.archivo.ruta || '').startsWith(`facturas/${ev.patente}/`)) errores.push('archivo');
  if (errores.length) return { error: 'datos', errores, status: 400 };

  const salida = new Date(datos.salida).toISOString();
  const monto = datos.monto === '' || datos.monto == null ? null : Number(datos.monto);
  const factura = String(datos.factura || '').trim().slice(0, 60) || null;
  const detalle = {
    ...ev.detalle,
    salida,
    dias: diasEnTaller(ev.detalle.ingreso, salida),
    monto,
    factura,
    notaSalida: String(datos.nota || '').trim().slice(0, 500) || null,
    cerradoPor: usuario.email,
  };
  detalle.gasto = gastoDeSalida(ev.detalle, { monto, factura });

  if (datos.archivo?.ruta) {
    const { data: blob } = await sb.storage.from('documentos').download(datos.archivo.ruta);
    if (!blob) return { error: 'archivo_sin_subir', status: 409 };
    const sha256 = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
    const { error: e1 } = await sb.from('archivos').insert({
      clase: 'factura', bucket: 'documentos', ruta: datos.archivo.ruta, evento_id: ev.id, patente: ev.patente,
      sha256, metadatos: { tipo: 'factura', numero: factura, monto },
    });
    if (e1 && e1.code !== '23505') throw new Error(e1.message);
  }
  const { error } = await sb.from('eventos').update({ detalle }).eq('id', ev.id);
  if (error) throw new Error(error.message);
  return { ok: true, dias: detalle.dias, gasto: detalle.gasto };
}
