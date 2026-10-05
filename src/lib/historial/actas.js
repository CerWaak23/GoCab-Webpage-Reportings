/**
 * Reglas de las actas de entrega y recepción (R8-R27). Funciones puras: las
 * usan el celular del coordinador y el servidor, y se prueban con Vitest.
 */
import { MOTIVO_MINIMO, KM_MAXIMO, TOMAS_CONDUCTOR } from './tomas';

/**
 * Tomas de entrega y recepción. Obligatorias: las mismas 5 del levantamiento
 * (así la recepción siempre compara contra lo que subió el conductor). El
 * resto es opcional: se ofrecen, pero se pueden saltar (decisión del usuario).
 */
export const TOMAS_OBLIGATORIAS = TOMAS_CONDUCTOR;
export const TOMAS_OPCIONALES = [
  'esquina_del_izq', 'esquina_del_der', 'esquina_tra_izq', 'esquina_tra_der',
  'llanta_del_izq', 'llanta_del_der', 'llanta_tra_izq', 'llanta_tra_der',
  'interior_delantero', 'interior_trasero', 'maleta',
];
export const TOMAS_PROTOCOLO = [...TOMAS_OBLIGATORIAS, ...TOMAS_OPCIONALES];

export const LADOS_CEDULA = ['cedula_frente', 'cedula_reverso'];
export const ESTADOS_CHECK = ['ok', 'falta', 'danado'];
export const TIPOS_ACTA = ['entrega', 'recepcion'];

/** Elementos de una versión de checklist: [{ grupo, items: [...] }] → lista plana. */
export const itemsChecklist = (checklist) => (checklist?.items || []).flatMap((g) => g.items);

/**
 * R23: la recepción compara cada toma con la última acta de referencia del
 * auto, en este orden de preferencia: entrega, levantamiento (o revisión del
 * conductor), ingreso. Devuelve el evento elegido o null.
 */
export function eventoDeReferencia(eventos) {
  const ultimo = (tipos) => (eventos || [])
    .filter((e) => tipos.includes(e.tipo))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
  return ultimo(['entrega']) || ultimo(['levantamiento', 'revision']) || ultimo(['ingreso']);
}

/** Por toma del protocolo, la foto de referencia o null ("sin referencia"). */
export function referenciasPorToma(fotosDelEvento, tomas = TOMAS_PROTOCOLO) {
  const de = new Map((fotosDelEvento || []).map((f) => [f.toma, f]));
  return Object.fromEntries(tomas.map((t) => [t, de.get(t) || null]));
}

/**
 * Revisa un acta antes de firmarla y antes de registrarla.
 *
 * @param acta {
 *   tipo, conductor: { id } | { provisional: { nombre, rut, telefono } },
 *   pideCedula, cedula: { cedula_frente, cedula_reverso },
 *   fotos: { [toma]: { sha256, ruta? } | { noSePudo, motivo } },
 *   checklist: { [item]: { estado, comentario? } }, km, firma: { sha256 } }
 * @param items elementos de la checklist vigente al abrir el acta
 * @param { conFirma } false para revisar antes de la pantalla de firma
 * @returns lista de errores (vacía si está bien)
 */
export function validarActa(acta, items, { conFirma = true } = {}) {
  const e = [];
  if (!TIPOS_ACTA.includes(acta?.tipo)) e.push('tipo');
  const c = acta?.conductor;
  if (!c?.id) {
    const p = c?.provisional;
    if (!p) e.push('conductor');
    else if (!p.nombre?.trim() || !p.rut) e.push('provisional');
  }
  if (acta?.tipo === 'entrega' && acta.pideCedula) {
    for (const lado of LADOS_CEDULA) if (!acta.cedula?.[lado]?.sha256) e.push(lado);
  }
  for (const t of TOMAS_PROTOCOLO) {
    const f = acta?.fotos?.[t];
    if (!f && TOMAS_OPCIONALES.includes(t)) continue;
    if (!f) e.push(`falta_${t}`);
    else if (f.noSePudo) { if (String(f.motivo || '').trim().length < MOTIVO_MINIMO) e.push(`motivo_${t}`); }
    else if (!/^[0-9a-f]{64}$/.test(f.sha256 || '')) e.push(`foto_${t}`);
  }
  for (const item of items) {
    const r = acta?.checklist?.[item];
    if (!ESTADOS_CHECK.includes(r?.estado)) e.push(`check_${item}`);
  }
  const km = acta?.km === '' || acta?.km == null ? NaN : Number(acta.km);
  if (!Number.isInteger(km) || km < 0 || km > KM_MAXIMO) e.push('km');
  if (conFirma && !/^[0-9a-f]{64}$/.test(acta?.firma?.sha256 || '')) e.push('firma');
  return e;
}

/**
 * Resumen que ve el conductor antes de firmar (R73) y que va en el PDF:
 * km, luces, cuántos elementos OK/Falta/Dañado, daños marcados y tomas sin foto.
 */
export function resumenActa(acta, items) {
  const cuenta = { ok: 0, falta: 0, danado: 0 };
  for (const item of items) {
    const est = acta?.checklist?.[item]?.estado;
    if (cuenta[est] != null) cuenta[est] += 1;
  }
  const danos = [
    ...TOMAS_PROTOCOLO.filter((t) => acta?.fotos?.[t]?.dano).map((t) => ({ toma: t, texto: acta.fotos[t].dano })),
    ...(acta?.libres || []).filter((l) => l.comentario).map((l) => ({ toma: 'libre', texto: l.comentario })),
  ];
  return {
    km: Number(acta?.km),
    luces: !!acta?.luces,
    checklist: cuenta,
    faltantes: items.filter((i) => acta?.checklist?.[i]?.estado === 'falta'),
    danados: items.filter((i) => acta?.checklist?.[i]?.estado === 'danado'),
    danos,
    sinFoto: TOMAS_PROTOCOLO.filter((t) => acta?.fotos?.[t]?.noSePudo).map((t) => ({ toma: t, motivo: acta.fotos[t].motivo })),
  };
}

/**
 * Pendientes que deja una recepción (R24): cada daño nuevo marcado en una
 * toma o en una foto libre, y cada elemento que falta o viene dañado. Sin monto.
 */
export function pendientesDeRecepcion(acta, items) {
  if (acta?.tipo !== 'recepcion') return [];
  const r = resumenActa(acta, items);
  return [
    ...r.danos.map((d) => ({ texto: `Daño nuevo (${d.toma}): ${d.texto}` })),
    ...r.faltantes.map((i) => ({ texto: `Falta: ${i}` })),
    ...r.danados.map((i) => ({ texto: `Dañado: ${i}` })),
  ];
}
