import 'server-only';
import { supabaseServidor } from '@/lib/supabase/server';
import { normalizarPatente } from '@/lib/patente';
import { estadoAuto, contarEstados } from './estado';
import { veContactoConductor, puedeHacerActas } from './permisos';

// Un pendiente (daño, falta de elemento) sigue abierto hasta que se cobra o se descarta.
const PENDIENTE_CERRADO = ['Cobrado', 'Descartado', 'Cerrado'];

function revisar(...respuestas) {
  for (const r of respuestas) if (r.error) throw new Error(r.error.message);
}

async function revisionDias(sb) {
  const { data } = await sb.from('configuracion').select('valor').eq('clave', 'revision_dias').maybeSingle();
  return Number(data?.valor) || 30;
}

const agrupar = (filas, clave) => {
  const m = new Map();
  for (const f of filas || []) {
    const k = f[clave];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return m;
};

/** Lista de la flota con el estado de cada auto (R2). */
export async function listaVehiculos(hoy) {
  const sb = supabaseServidor();
  const [autos, vigentes, eventos, pendientes, archivos, carga, dias] = await Promise.all([
    sb.from('autos').select('patente, marca, modelo, anio, color, estado_fleet, modalidad, fotos_ingreso_pendientes').order('patente'),
    sb.from('asignaciones').select('patente, conductor_id, desde, origen, reemplazo, reemplaza_patente, conductores(nombre)').is('hasta', null),
    sb.from('eventos').select('patente, tipo, fecha, conductor_id, detalle'),
    sb.from('pendientes').select('patente, estado'),
    sb.from('archivos').select('patente, clase, vence, metadatos').not('vence', 'is', null),
    sb.from('cargas').select('creado').eq('tipo', 'vehicles').eq('aplicada', true).order('creado', { ascending: false }).limit(1),
    revisionDias(sb),
  ]);
  revisar(autos, vigentes, eventos, pendientes, archivos, carga);

  const vigenteDe = new Map(vigentes.data.map((v) => [v.patente, v]));
  const eventosDe = agrupar(eventos.data, 'patente');
  const archivosDe = agrupar(archivos.data, 'patente');
  const abiertos = agrupar(pendientes.data.filter((p) => !PENDIENTE_CERRADO.includes(p.estado)), 'patente');

  const filas = autos.data.map((a) => {
    const vigente = vigenteDe.get(a.patente) || null;
    const e = estadoAuto({
      auto: a,
      vigente,
      eventos: eventosDe.get(a.patente) || [],
      archivos: archivosDe.get(a.patente) || [],
      pendientes: abiertos.get(a.patente)?.length || 0,
      hoy,
      revisionDias: dias,
    });
    return {
      patente: a.patente,
      marca: a.marca,
      modelo: a.modelo,
      anio: a.anio,
      color: a.color,
      estadoFleet: a.estado_fleet,
      modalidad: a.modalidad,
      conductor: vigente?.conductores?.nombre ?? null,
      desde: vigente?.desde ?? null,
      ...e,
    };
  });
  return { hoy, filas, conteo: contarEstados(filas), ultimaCarga: carga.data[0]?.creado ?? null };
}

/** Ficha de un auto: datos, conductor actual, historia, archivos y pendientes. */
export async function fichaVehiculo(patenteCruda, usuario, hoy) {
  const patente = normalizarPatente(patenteCruda);
  const sb = supabaseServidor();
  const contacto = veContactoConductor(usuario);
  const camposConductor = contacto
    ? 'id, nombre, rut, rut_valido, telefono, licencia, vence_cedula, baja, cedula_registrada'
    : 'id, nombre, baja, cedula_registrada';

  const [auto, asignaciones, eventos, archivos, pendientes, dias] = await Promise.all([
    sb.from('autos').select('*').eq('patente', patente).maybeSingle(),
    sb.from('asignaciones').select(`id, desde, hasta, origen, reemplazo, reemplaza_patente, conductor_id, conductores(${camposConductor})`)
      .eq('patente', patente).order('desde', { ascending: false }),
    sb.from('eventos').select('id, tipo, fecha, conductor_id, usuario_email, firmado, detalle, pdf_ruta, conductores(nombre), notas(id, texto, autor_email, creado), taller_actualizaciones(id, fecha, autor_email, texto, estado, monto)')
      .eq('patente', patente).order('fecha', { ascending: false }),
    sb.from('archivos').select('id, clase, toma, tomada_en, recibida_en, vence, metadatos, evento_id, conductor_id').eq('patente', patente),
    sb.from('pendientes').select('id, texto, estado, monto, creado, evento_id, conductores(nombre)').eq('patente', patente).order('creado', { ascending: false }),
    revisionDias(sb),
  ]);
  revisar(auto, asignaciones, eventos, archivos, pendientes);
  if (!auto.data) return null;

  const vigente = asignaciones.data.find((a) => !a.hasta) || null;
  const abiertos = pendientes.data.filter((p) => !PENDIENTE_CERRADO.includes(p.estado));
  const estado = estadoAuto({
    auto: auto.data,
    vigente,
    eventos: eventos.data,
    archivos: archivos.data.filter((a) => a.vence),
    pendientes: abiertos.length,
    hoy,
    revisionDias: dias,
  });

  return {
    hoy,
    auto: auto.data,
    conductor: vigente?.conductores ?? null,
    vigente: vigente && { desde: vigente.desde, origen: vigente.origen, reemplazo: vigente.reemplazo, reemplazaPatente: vigente.reemplaza_patente },
    ...estado,
    historia: historia(asignaciones.data, eventos.data, archivos.data),
    archivos: archivos.data,
    pendientes: pendientes.data.map((p) => ({ ...p, abierto: !PENDIENTE_CERRADO.includes(p.estado) })),
    contacto,
    puedeNotas: puedeHacerActas(usuario),
  };
}

/**
 * Historia del auto (R4): eventos de GoBills más los cambios de conductor que
 * informa Fleet, en orden cronológico inverso.
 */
function historia(asignaciones, eventos, archivos = []) {
  const actaDe = new Map(archivos.filter((a) => a.clase === 'acta').map((a) => [a.evento_id, a.id]));
  const items = [];
  for (const a of asignaciones) {
    const nombre = a.conductores?.nombre ?? null;
    items.push({ id: `a-${a.id}-d`, tipo: 'fleet_asigna', fecha: a.desde, conductor: nombre, origen: a.origen, reemplazo: a.reemplazo, reemplazaPatente: a.reemplaza_patente });
    if (a.hasta) items.push({ id: `a-${a.id}-h`, tipo: 'fleet_quita', fecha: a.hasta, conductor: nombre });
  }
  for (const e of eventos) {
    items.push({
      id: e.id, eventoId: e.id, tipo: e.tipo, fecha: e.fecha, conductor: e.conductores?.nombre ?? null, usuario: e.usuario_email,
      firmado: e.firmado, detalle: e.detalle, actaId: actaDe.get(e.id) || null,
      notas: [...(e.notas || [])].sort((a, b) => String(a.creado).localeCompare(String(b.creado))),
      actualizaciones: [...(e.taller_actualizaciones || [])].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
    });
  }
  // A igual fecha, el evento de GoBills (con hora) va antes que el cambio de Fleet.
  return items.sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)));
}

/** Flota por períodos (R7): asignaciones y eventos que tocan el rango. */
export async function flotaEnElTiempo(desde, hasta) {
  const sb = supabaseServidor();
  const [autos, asignaciones, eventos] = await Promise.all([
    sb.from('autos').select('patente, marca, modelo, estado_fleet').order('patente'),
    sb.from('asignaciones').select('patente, desde, hasta, reemplazo, conductores(nombre)')
      .lte('desde', hasta).or(`hasta.is.null,hasta.gte.${desde}`),
    sb.from('eventos').select('patente, tipo, fecha, detalle').gte('fecha', desde).lte('fecha', `${hasta}T23:59:59`),
  ]);
  revisar(autos, asignaciones, eventos);
  const asigDe = agrupar(asignaciones.data, 'patente');
  const evDe = agrupar(eventos.data, 'patente');
  return {
    desde,
    hasta,
    autos: autos.data.map((a) => ({
      patente: a.patente,
      modelo: [a.marca, a.modelo].filter(Boolean).join(' '),
      estadoFleet: a.estado_fleet,
      periodos: (asigDe.get(a.patente) || []).map((p) => ({ desde: p.desde, hasta: p.hasta, conductor: p.conductores?.nombre ?? null, reemplazo: p.reemplazo })),
      eventos: (evDe.get(a.patente) || []).map((e) => ({ tipo: e.tipo, fecha: e.fecha, salida: e.detalle?.salida ?? null })),
    })),
  };
}
