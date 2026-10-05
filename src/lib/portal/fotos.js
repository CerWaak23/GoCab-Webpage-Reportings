import 'server-only';
import { supabaseServidor } from '@/lib/supabase/server';
import { hoyEnChile } from '@/lib/carga/payload';
import { revision as calcularRevision } from '@/lib/historial/estado';
import { TOMAS_CONDUCTOR, tipoDeFotos, validarEnvio, rutaFoto } from '@/lib/historial/tomas';
import { autoDeLaSesion } from './acceso';
import { AVISO_VERSION } from './aviso';

const BUCKET = 'fotos';
// La revisión se puede adelantar unos días; antes de eso el auto está al día.
const DIAS_ANTES_REVISION = 5;

async function revisionDias(sb) {
  const { data } = await sb.from('configuracion').select('valor').eq('clave', 'revision_dias').maybeSingle();
  return Number(data?.valor) || 30;
}

/**
 * Qué fotos le tocan al conductor: levantamiento si aún no tiene acta de este
 * auto, o revisión periódica. Las fotos anteriores son solo las suyas (R38),
 * nunca las de otro conductor.
 */
export async function estadoFotos(sesion) {
  const auto = await autoDeLaSesion(sesion);
  if (!auto) return null;
  const sb = supabaseServidor();
  const hoy = hoyEnChile();
  const { data: eventos, error } = await sb.from('eventos')
    .select('id, tipo, fecha, conductor_id').eq('patente', auto.patente).eq('conductor_id', sesion.conductorId);
  if (error) throw new Error(error.message);

  const tipo = tipoDeFotos(eventos, sesion.conductorId, auto.desde);
  const rev = tipo === 'revision' ? calcularRevision(eventos, hoy, await revisionDias(sb)) : null;
  const diasParaVencer = rev ? Math.round((Date.parse(rev.vence) - Date.parse(hoy)) / 86400000) : null;
  const puede = auto.vigente && (tipo === 'levantamiento' || diasParaVencer <= DIAS_ANTES_REVISION);

  return {
    patente: auto.patente,
    vigente: auto.vigente,
    tipo,
    puede,
    vence: rev?.vence ?? null,
    vencida: !!rev?.vencida,
    tomas: TOMAS_CONDUCTOR,
    anteriores: puede ? await fotosAnteriores(sb, auto.patente, sesion.conductorId) : {},
  };
}

async function fotosAnteriores(sb, patente, conductorId) {
  const { data } = await sb.from('archivos').select('toma, ruta, recibida_en')
    .eq('patente', patente).eq('conductor_id', conductorId).eq('clase', 'foto')
    .order('recibida_en', { ascending: false });
  const ultima = {};
  for (const a of data || []) if (a.toma && !ultima[a.toma]) ultima[a.toma] = a.ruta;
  const out = {};
  await Promise.all(Object.entries(ultima).map(async ([toma, ruta]) => {
    const { data: u } = await sb.storage.from(BUCKET).createSignedUrl(ruta, 600);
    if (u) out[toma] = u.signedUrl;
  }));
  return out;
}

/** URL firmada para subir una foto del auto vigente del conductor. */
export async function urlSubida(sesion, uid, toma) {
  const estado = await estadoFotos(sesion);
  if (!estado?.puede) return { error: 'no_corresponde' };
  if (!TOMAS_CONDUCTOR.includes(toma)) return { error: 'toma' };
  const ruta = rutaFoto(estado.patente, uid, toma);
  const { data, error } = await supabaseServidor().storage.from(BUCKET).createSignedUploadUrl(ruta, { upsert: true });
  if (error) throw new Error(error.message);
  return { ruta, token: data.token };
}

const rutaValida = (ruta, patente, uid, toma) =>
  new RegExp(`^${patente}/\\d{4}-\\d{2}/${uid}-${toma}\\.jpg$`).test(ruta || '');

async function existe(sb, ruta) {
  const i = ruta.lastIndexOf('/');
  const { data } = await sb.storage.from(BUCKET).list(ruta.slice(0, i), { search: ruta.slice(i + 1) });
  return (data || []).some((f) => f.name === ruta.slice(i + 1));
}

/**
 * Registra el levantamiento o la revisión. Idempotente por el uid del
 * teléfono: reenviar no duplica. Si una foto no llegó al servidor, no se
 * registra nada (el teléfono la vuelve a subir).
 */
export async function registrarEnvio(sesion, envio, red) {
  const estado = await estadoFotos(sesion);
  if (!estado?.puede) return { error: 'no_corresponde', status: 403 };

  const sb = supabaseServidor();
  const { data: previo } = await sb.from('eventos').select('id').eq('detalle->>uid', envio.uid).maybeSingle();
  if (previo) return { ok: true, id: previo.id, tipo: estado.tipo };

  const errores = validarEnvio(envio);
  for (const t of TOMAS_CONDUCTOR) {
    const f = envio.fotos?.[t];
    if (f && !f.noSePudo && !rutaValida(f.ruta, estado.patente, envio.uid, t)) errores.push(`ruta_${t}`);
  }
  if (errores.length) return { error: 'datos', errores, status: 400 };

  const faltan = [];
  for (const t of TOMAS_CONDUCTOR) {
    const f = envio.fotos[t];
    if (!f.noSePudo && !(await existe(sb, f.ruta))) faltan.push(t);
  }
  if (faltan.length) return { error: 'fotos_sin_subir', faltan, status: 409 };

  const detalle = {
    uid: envio.uid,
    origen: 'portal',
    km: Number(envio.km),
    luces: !!envio.luces,
    tomas: Object.fromEntries(TOMAS_CONDUCTOR.map((t) => [t, envio.fotos[t].noSePudo ? 'no_se_pudo' : 'ok'])),
    motivos: Object.fromEntries(TOMAS_CONDUCTOR.filter((t) => envio.fotos[t].noSePudo).map((t) => [t, String(envio.fotos[t].motivo).trim().slice(0, 300)])),
    // Evidencia de quién aceptó el aviso y desde dónde (KTD8).
    red: { ip: red.ip, navegador: String(red.navegador || '').slice(0, 200) },
  };
  const { data: evento, error } = await sb.from('eventos').insert({
    patente: estado.patente,
    conductor_id: sesion.conductorId,
    tipo: estado.tipo,
    fecha: new Date().toISOString(),
    usuario_email: null,
    firmado: false,
    version_aviso: AVISO_VERSION,
    detalle,
  }).select('id').single();
  if (error) throw new Error(error.message);

  const filas = TOMAS_CONDUCTOR.filter((t) => !envio.fotos[t].noSePudo).map((t) => ({
    clase: 'foto',
    bucket: BUCKET,
    ruta: envio.fotos[t].ruta,
    evento_id: evento.id,
    patente: estado.patente,
    conductor_id: sesion.conductorId,
    toma: t,
    sha256: envio.fotos[t].sha256,
    tomada_en: envio.fotos[t].tomadaEn || null,
  }));
  const { error: e2 } = await sb.from('archivos').insert(filas);
  if (e2) {
    // Sin transacción entre tablas: si las fotos no quedan, tampoco el evento.
    await sb.from('eventos').delete().eq('id', evento.id);
    throw new Error(e2.message);
  }
  return { ok: true, id: evento.id, tipo: estado.tipo };
}
