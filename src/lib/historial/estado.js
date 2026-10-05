/**
 * Estado de cada auto en el Historial. Fleet dice quién tiene el auto; GoBills
 * dice si eso está documentado (actas, levantamiento, revisión, taller).
 *
 * Un solo estado principal, el más urgente, más alertas secundarias.
 */

export const DIAS_ENTREGA_PENDIENTE = 7;
export const DIAS_AVISO_DOCUMENTO = 30;

// De más a menos urgente; también es el orden de los filtros de la lista.
export const ESTADOS = [
  'siniestro',
  'sin_ingreso_taller',
  'en_taller',
  'entrega_pendiente',
  'fotos_ingreso',
  'falta_levantamiento',
  'con_conductor',
  'disponible',
  'baja',
];

const DIA = 86400000;
const dia = (f) => String(f || '').slice(0, 10);
export const diasEntre = (desde, hasta) => Math.round((Date.parse(dia(hasta)) - Date.parse(dia(desde))) / DIA);

const abierto = (e) => !e.detalle?.cerrado && !e.detalle?.salida;

/** Último evento de ciertos tipos (eventos de un auto, en cualquier orden). */
function ultimo(eventos, tipos, filtro = () => true) {
  return eventos
    .filter((e) => tipos.includes(e.tipo) && filtro(e))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
}

/**
 * Revisión periódica (R36): cada N días desde la última entrega, levantamiento
 * o revisión. Sin ninguna de ellas no hay plazo (falta el levantamiento).
 */
export function revision(eventos, hoy, dias = 30) {
  const base = ultimo(eventos, ['entrega', 'levantamiento', 'revision']);
  if (!base) return null;
  const vence = new Date(Date.parse(dia(base.fecha)) + dias * DIA).toISOString().slice(0, 10);
  const atraso = diasEntre(vence, hoy);
  return { desde: dia(base.fecha), vence, vencida: atraso > 0, diasVencida: Math.max(0, atraso) };
}

/** Documentos con vencimiento (permiso de circulación, SOAP, cédula). */
export function documentosPorVencer(archivos, hoy, dias = DIAS_AVISO_DOCUMENTO) {
  return (archivos || [])
    .filter((a) => a.vence)
    .map((a) => ({ ...a, dias: diasEntre(hoy, a.vence) }))
    .filter((a) => a.dias <= dias)
    .sort((a, b) => a.dias - b.dias);
}

/**
 * @param auto      { patente, estado_fleet, fotos_ingreso_pendientes }
 * @param vigente   asignación vigente { conductor_id, desde, origen, reemplazo } o null
 * @param eventos   eventos del auto [{ tipo, fecha, conductor_id, detalle }]
 * @param archivos  archivos del auto con vencimiento [{ vence, clase, metadatos }]
 * @param pendientes cantidad de pendientes abiertos
 */
export function estadoAuto({ auto, vigente = null, eventos = [], archivos = [], pendientes = 0, hoy, revisionDias = 30 }) {
  const alertas = [];
  const siniestroAbierto = ultimo(eventos, ['siniestro'], (e) => abierto(e) && e.detalle?.circula === false);
  const tallerAbierto = ultimo(eventos, ['taller'], abierto);

  let estado;
  if (siniestroAbierto) estado = 'siniestro';
  else if (tallerAbierto) estado = 'en_taller';
  // R60: Fleet lo tiene en mantención pero en GoBills no hay ingreso a taller.
  else if (auto.estado_fleet === 'maintenance') estado = 'sin_ingreso_taller';
  else if (auto.estado_fleet === 'total_loss') estado = 'baja';
  else if (vigente) {
    const entrega = ultimo(eventos, ['entrega'], (e) => e.conductor_id === vigente.conductor_id);
    const levantamiento = ultimo(eventos, ['levantamiento', 'revision'], (e) => dia(e.fecha) >= dia(vigente.desde));
    if (entrega || levantamiento) estado = 'con_conductor';
    // La flota que ya circulaba cuando partió GoBills necesita levantamiento (R28-R30).
    else if (vigente.origen === 'preexistente') estado = 'falta_levantamiento';
    else if (diasEntre(vigente.desde, hoy) <= DIAS_ENTREGA_PENDIENTE) estado = 'entrega_pendiente';
    else estado = 'falta_levantamiento';
  } else estado = 'disponible';

  if (auto.fotos_ingreso_pendientes && !ultimo(eventos, ['ingreso'])) {
    if (estado === 'disponible') estado = 'fotos_ingreso';
    else alertas.push({ tipo: 'fotos_ingreso' });
  }

  const rev = vigente ? revision(eventos, hoy, revisionDias) : null;
  if (rev?.vencida) alertas.push({ tipo: 'revision_vencida', dias: rev.diasVencida });
  for (const d of documentosPorVencer(archivos, hoy)) {
    alertas.push({ tipo: d.dias < 0 ? 'documento_vencido' : 'documento_por_vencer', dias: d.dias, documento: d.metadatos?.tipo || d.clase });
  }
  if (vigente?.reemplazo) alertas.push({ tipo: 'reemplazo', patente: vigente.reemplaza_patente || null });
  if (pendientes > 0) alertas.push({ tipo: 'pendientes', cantidad: pendientes });

  return { estado, alertas, revision: rev };
}

/** Cuántos autos hay en cada estado, para los filtros. */
export function contarEstados(filas) {
  const c = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const f of filas) c[f.estado] = (c[f.estado] || 0) + 1;
  return c;
}
