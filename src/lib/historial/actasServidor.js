import 'server-only';
import { createHash } from 'node:crypto';
import { supabaseServidor } from '@/lib/supabase/server';
import { normalizarPatente } from '@/lib/patente';
import { formatearRut } from '@/lib/rut';
import { normalizarNombre, limpiarNombre } from '@/lib/fleet/nombres';
import { hoyEnChile } from '@/lib/carga/payload';
import { UID } from './tomas';
import {
  TOMAS_PROTOCOLO, LADOS_CEDULA, eventoDeReferencia, referenciasPorToma, validarActa,
  itemsChecklist, pendientesDeRecepcion,
} from './actas';
import { generarPdfActa } from './pdf';
import { CLAUSULA_RECEPCION_VERSION } from '@/lib/portal/aviso';

const DIAS_RECEPCION = 30;
const restarDias = (f, d) => new Date(Date.parse(f) - d * 86400000).toISOString().slice(0, 10);

function revisar(...rs) {
  for (const r of rs) if (r.error) throw new Error(r.error.message);
}

export async function checklistVigente(sb = supabaseServidor(), version = null) {
  let q = sb.from('checklists').select('version, items');
  q = version ? q.eq('version', version) : q.order('version', { ascending: false }).limit(1);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data[0] || null;
}

/**
 * Lo que necesita el celular para abrir una entrega o recepción: el auto, la
 * checklist vigente, el conductor propuesto por Fleet (R18) y, en la
 * recepción, la foto de referencia de cada toma (R23).
 */
export async function datosProtocolo(patenteCruda, tipo) {
  const patente = normalizarPatente(patenteCruda);
  const sb = supabaseServidor();
  const [auto, asignaciones, eventos, checklist, carga] = await Promise.all([
    sb.from('autos').select('patente, marca, modelo, anio, color, estado_fleet').eq('patente', patente).maybeSingle(),
    sb.from('asignaciones').select('desde, hasta, conductores(id, nombre, rut, cedula_registrada, baja)')
      .eq('patente', patente).order('desde', { ascending: false }).limit(5),
    sb.from('eventos').select('id, tipo, fecha, detalle').eq('patente', patente),
    checklistVigente(sb),
    sb.from('cargas').select('creado').eq('tipo', 'vehicles').eq('aplicada', true).order('creado', { ascending: false }).limit(1),
  ]);
  revisar(auto, asignaciones, eventos, carga);
  if (!auto.data) return null;

  const vigente = asignaciones.data.find((a) => !a.hasta);
  let propuesto = null;
  if (tipo === 'entrega') propuesto = vigente?.conductores ?? null;
  else {
    // Recibe del conductor que lo tiene, o del que lo devolvió hace poco.
    const reciente = vigente || asignaciones.data.find((a) => a.hasta >= restarDias(hoyEnChile(), DIAS_RECEPCION));
    propuesto = reciente?.conductores ?? null;
  }

  const ultimoKm = [...eventos.data]
    .filter((e) => Number.isFinite(e.detalle?.km))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0]?.detalle.km ?? null;

  let referencia = null;
  if (tipo === 'recepcion') {
    const ref = eventoDeReferencia(eventos.data);
    if (ref) {
      const { data: fotos } = await sb.from('archivos').select('toma, ruta').eq('evento_id', ref.id).eq('clase', 'foto');
      const porToma = referenciasPorToma(fotos || []);
      const rutas = Object.values(porToma).filter(Boolean).map((f) => f.ruta);
      const { data: urls } = rutas.length ? await sb.storage.from('fotos').createSignedUrls(rutas, 1800) : { data: [] };
      const urlDe = new Map((urls || []).map((u) => [u.path, u.signedUrl]));
      referencia = {
        tipo: ref.tipo,
        fecha: ref.fecha,
        fotos: Object.fromEntries(Object.entries(porToma).map(([t, f]) => [t, f ? urlDe.get(f.ruta) || null : null])),
      };
    }
  }

  return {
    auto: auto.data,
    checklist,
    propuesto: propuesto && {
      id: propuesto.id, nombre: propuesto.nombre, rut: propuesto.rut,
      cedulaRegistrada: propuesto.cedula_registrada, baja: propuesto.baja,
    },
    ultimaCarga: carga.data[0]?.creado ?? null,
    ultimoKm,
    referencia,
  };
}

/** Conductores para elegir otro en la entrega (sin datos de contacto). */
export async function conductoresParaElegir() {
  const { data, error } = await supabaseServidor().from('conductores')
    .select('id, nombre, cedula_registrada, patentes_fleet').is('baja', null).order('nombre');
  if (error) throw new Error(error.message);
  return data.map((c) => ({ id: c.id, nombre: c.nombre, cedulaRegistrada: c.cedula_registrada, patentes: c.patentes_fleet }));
}

/**
 * Dónde va cada archivo del acta. Las rutas no llevan RUT ni nombres (R66);
 * el uid del teléfono las hace idempotentes.
 */
export function rutaArchivoActa(patente, uid, clase, parte) {
  const mes = new Date().toISOString().slice(0, 7);
  if (clase === 'foto') return { bucket: 'fotos', ruta: `${patente}/${mes}/${uid}-${parte}.jpg` };
  if (clase === 'cedula') return { bucket: 'documentos', ruta: `cedulas/${mes}/${uid}-${parte}.jpg` };
  if (clase === 'firma') return { bucket: 'documentos', ruta: `firmas/${mes}/${uid}.png` };
  return null;
}

const PARTE_VALIDA = {
  foto: (p) => TOMAS_PROTOCOLO.includes(p) || /^libre-\d{1,2}$/.test(p),
  cedula: (p) => LADOS_CEDULA.includes(p),
  firma: () => true,
};

export async function urlSubidaActa({ uid, patente: patenteCruda, clase, parte }) {
  const patente = normalizarPatente(patenteCruda);
  if (!UID.test(uid || '') || !patente || !PARTE_VALIDA[clase]?.(parte)) return { error: 'datos' };
  const destino = rutaArchivoActa(patente, uid, clase, parte);
  const { data, error } = await supabaseServidor().storage.from(destino.bucket).createSignedUploadUrl(destino.ruta, { upsert: true });
  if (error) throw new Error(error.message);
  return { ...destino, token: data.token };
}

async function existe(sb, bucket, ruta) {
  const i = ruta.lastIndexOf('/');
  const { data } = await sb.storage.from(bucket).list(ruta.slice(0, i), { search: ruta.slice(i + 1) });
  return (data || []).some((f) => f.name === ruta.slice(i + 1));
}

/** Conductor del acta: el elegido, o el provisional (R18), que se une por RUT en la próxima carga. */
async function resolverConductor(sb, c) {
  if (c?.id) {
    const { data } = await sb.from('conductores').select('id, nombre, rut, cedula_registrada').eq('id', c.id).maybeSingle();
    return data;
  }
  const rut = formatearRut(c?.provisional?.rut);
  if (!rut) return null;
  const { data: ya } = await sb.from('conductores').select('id, nombre, rut, cedula_registrada').eq('rut', rut).maybeSingle();
  if (ya) return ya;
  const nombre = limpiarNombre(c.provisional.nombre);
  const { data, error } = await sb.from('conductores').insert({
    rut, rut_valido: true, rut_crudo: c.provisional.rut, nombre, clave_nombre: normalizarNombre(nombre),
    telefono: c.provisional.telefono || null, provisional: true,
  }).select('id, nombre, rut, cedula_registrada').single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Registra un acta firmada. Idempotente por el uid del teléfono. Se arma sin
 * firmar (eventos + archivos + pendientes) y se sella al final, porque una
 * vez firmada la base no deja cambiarla ni borrarla (migración 0004). Luego
 * se genera el PDF; si falla, el acta igual queda y el PDF se reintenta.
 */
export async function registrarActa(usuario, acta, red) {
  const sb = supabaseServidor();
  const patente = normalizarPatente(acta?.patente);
  if (!UID.test(acta?.uid || '') || !patente) return { error: 'datos', status: 400 };

  const { data: previo } = await sb.from('eventos').select('id, pdf_ruta').eq('detalle->>uid', acta.uid).maybeSingle();
  if (previo) return { ok: true, id: previo.id, pdf: !!previo.pdf_ruta, repetida: true };

  const checklist = await checklistVigente(sb, acta.checklistVersion);
  if (!checklist) return { error: 'checklist', status: 400 };
  const items = itemsChecklist(checklist);

  const conductor = await resolverConductor(sb, acta.conductor);
  if (!conductor) return { error: 'conductor', status: 400 };
  const pideCedula = acta.tipo === 'entrega' && !conductor.cedula_registrada;

  const errores = validarActa({ ...acta, conductor: { id: conductor.id }, pideCedula }, items);
  if (acta.tipo === 'entrega' && acta.clausula !== CLAUSULA_RECEPCION_VERSION) errores.push('clausula_version');
  if (errores.length) return { error: 'datos', errores, status: 400 };
  const conFirma = !acta.sinFirma;

  // Cada archivo tiene que estar en Storage, en la ruta que le corresponde.
  const archivos = [];
  for (const t of TOMAS_PROTOCOLO) {
    const f = acta.fotos[t];
    if (!f || f.noSePudo) continue;
    archivos.push({ clase: 'foto', parte: t, toma: t, f, metadatos: f.dano ? { dano: String(f.dano).slice(0, 300) } : {} });
  }
  (acta.libres || []).slice(0, 20).forEach((f, i) => archivos.push({ clase: 'foto', parte: `libre-${i + 1}`, toma: 'libre', f, metadatos: { comentario: String(f.comentario || '').slice(0, 300) } }));
  if (pideCedula) for (const lado of LADOS_CEDULA) archivos.push({ clase: 'cedula', parte: lado, toma: null, f: acta.cedula[lado], metadatos: { lado } });
  if (conFirma) archivos.push({ clase: 'firma', parte: 'firma', toma: null, f: acta.firma, metadatos: { firmadaEn: acta.firma.firmadaEn || null } });

  // El mes de la ruta es el de la subida: puede cambiar si se envía al día siguiente.
  const sinMes = (r) => String(r || '').replace(/\/\d{4}-\d{2}\//, '/');
  const faltan = [];
  for (const a of archivos) {
    const destino = rutaArchivoActa(patente, acta.uid, a.clase, a.parte);
    if (sinMes(a.f.ruta) !== sinMes(destino.ruta) || !(await existe(sb, destino.bucket, a.f.ruta))) faltan.push(a.parte);
    a.bucket = destino.bucket;
  }
  if (faltan.length) return { error: 'archivos_sin_subir', faltan, status: 409 };

  const detalle = {
    uid: acta.uid,
    origen: 'coordinador',
    km: Number(acta.km),
    luces: !!acta.luces,
    checklist: Object.fromEntries(items.map((i) => [i, { estado: acta.checklist[i].estado, comentario: String(acta.checklist[i].comentario || '').slice(0, 200) || undefined }])),
    tomas: Object.fromEntries(TOMAS_PROTOCOLO.filter((t) => acta.fotos[t]).map((t) => [t, acta.fotos[t].noSePudo ? 'no_se_pudo' : 'ok'])),
    motivos: Object.fromEntries(TOMAS_PROTOCOLO.filter((t) => acta.fotos[t]?.noSePudo).map((t) => [t, String(acta.fotos[t].motivo).slice(0, 300)])),
    comentario: String(acta.comentario || '').slice(0, 1000),
    provisional: !acta.conductor?.id,
    iniciado: acta.iniciado || null,
    firma: conFirma ? { firmadaEn: acta.firma.firmadaEn || null, ip: red.ip, navegador: String(red.navegador || '').slice(0, 200) } : null,
    // Recepción sin el conductor (lo dejó botado): vale la cláusula que aceptó en la entrega.
    sinFirma: conFirma ? undefined : {
      motivo: String(acta.sinFirma.motivo).trim().slice(0, 500),
      testigo: String(acta.sinFirma.testigo || '').trim().slice(0, 120) || undefined,
      ip: red.ip,
    },
    clausula: acta.tipo === 'entrega' ? CLAUSULA_RECEPCION_VERSION : undefined,
  };

  const { data: evento, error } = await sb.from('eventos').insert({
    patente,
    conductor_id: conductor.id,
    tipo: acta.tipo,
    fecha: new Date().toISOString(),
    usuario_email: usuario.email,
    firmado: false,
    checklist_version: checklist.version,
    version_aviso: acta.aviso,
    detalle,
  }).select('id').single();
  if (error) throw new Error(error.message);

  try {
    const filas = archivos.map((a) => ({
      clase: a.clase,
      bucket: a.bucket,
      ruta: a.f.ruta,
      evento_id: evento.id,
      patente: a.clase === 'foto' ? patente : null,
      conductor_id: conductor.id,
      toma: a.toma,
      sha256: a.f.sha256,
      tomada_en: a.f.tomadaEn || null,
      metadatos: a.metadatos,
    }));
    revisar(await sb.from('archivos').insert(filas));

    const pend = pendientesDeRecepcion({ ...acta, conductor: { id: conductor.id } }, items);
    if (pend.length) {
      revisar(await sb.from('pendientes').insert(pend.map((p) => ({ patente, conductor_id: conductor.id, evento_id: evento.id, texto: p.texto }))));
    }
    if (pideCedula) revisar(await sb.from('conductores').update({ cedula_registrada: true }).eq('id', conductor.id));

    // Sellar: desde aquí el acta no se puede cambiar ni borrar.
    revisar(await sb.from('eventos').update({ firmado: true }).eq('id', evento.id));
  } catch (err) {
    await sb.from('pendientes').delete().eq('evento_id', evento.id);
    await sb.from('archivos').delete().eq('evento_id', evento.id);
    await sb.from('eventos').delete().eq('id', evento.id);
    throw err;
  }

  const pdf = await adjuntarPdf(evento.id).catch((err) => {
    console.error('[actas] pdf', err.message);
    return false;
  });
  return { ok: true, id: evento.id, pdf };
}

/** Genera el PDF de un acta firmada y lo deja en el bucket actas (KTD8). */
export async function adjuntarPdf(eventoId) {
  const sb = supabaseServidor();
  const { data: ev } = await sb.from('eventos')
    .select('id, patente, tipo, fecha, usuario_email, firmado, conductor_id, checklist_version, version_aviso, detalle, pdf_ruta, conductores(nombre, rut), autos(marca, modelo, anio, color)')
    .eq('id', eventoId).single();
  if (!ev?.firmado) throw new Error('El acta no está firmada');
  if (ev.pdf_ruta) return true;

  const { data: archivos } = await sb.from('archivos').select('clase, bucket, ruta, toma, metadatos').eq('evento_id', eventoId);
  const bajar = async (a) => {
    const { data } = await sb.storage.from(a.bucket).download(a.ruta);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  };
  const fotos = [];
  for (const a of archivos.filter((x) => x.clase === 'foto')) fotos.push({ toma: a.toma, metadatos: a.metadatos, datos: await bajar(a) });
  const firmaArchivo = archivos.find((x) => x.clase === 'firma');
  const firma = firmaArchivo ? await bajar(firmaArchivo) : null;
  const checklist = await checklistVigente(sb, ev.checklist_version);

  // Sin firma: la entrega de ese conductor, con la cláusula que aceptó.
  let entregaPrevia = null;
  if (ev.detalle?.sinFirma) {
    const { data } = await sb.from('eventos').select('fecha, detalle').eq('patente', ev.patente).eq('tipo', 'entrega')
      .eq('conductor_id', ev.conductor_id).lt('fecha', ev.fecha).order('fecha', { ascending: false }).limit(1);
    entregaPrevia = data?.[0] ? { fecha: data[0].fecha, clausula: data[0].detalle?.clausula || null } : null;
  }

  const pdf = await generarPdfActa({ evento: ev, fotos, firma, checklist, entregaPrevia });
  const hash = createHash('sha256').update(pdf).digest('hex');
  const ruta = `${ev.patente}/${ev.detalle.uid}.pdf`;
  const { error: e1 } = await sb.storage.from('actas').upload(ruta, pdf, { contentType: 'application/pdf', upsert: true });
  if (e1) throw new Error(e1.message);
  const { data: ya } = await sb.from('archivos').select('id').eq('ruta', ruta).maybeSingle();
  if (!ya) {
    revisar(await sb.from('archivos').insert({
      clase: 'acta', bucket: 'actas', ruta, evento_id: ev.id, patente: ev.patente, sha256: hash, metadatos: { tipo: 'acta' },
    }));
  }
  revisar(await sb.from('eventos').update({ pdf_ruta: ruta, pdf_hash: hash, sincronizado: new Date().toISOString() }).eq('id', ev.id));
  return true;
}
