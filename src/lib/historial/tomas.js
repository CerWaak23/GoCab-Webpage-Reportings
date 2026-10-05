/**
 * Tomas guiadas del levantamiento y la revisión periódica que hace el
 * conductor desde el portal (R28, R36): frente, trasera, dos costados y
 * tablero con el km.
 */
export const TOMAS_CONDUCTOR = ['frente', 'trasera', 'lateral_izquierdo', 'lateral_derecho', 'tablero'];

export const KM_MAXIMO = 2_000_000;
export const MOTIVO_MINIMO = 5;

/**
 * Levantamiento si este conductor todavía no tiene un acta del auto desde que
 * Fleet se lo asignó (entrega o levantamiento); si ya la tiene, es una
 * revisión periódica.
 */
export function tipoDeFotos(eventos, conductorId, desde) {
  const base = (eventos || []).some((e) => ['entrega', 'levantamiento'].includes(e.tipo)
    && e.conductor_id === conductorId && String(e.fecha).slice(0, 10) >= String(desde).slice(0, 10));
  return base ? 'revision' : 'levantamiento';
}

/**
 * Revisa un envío antes de crear el evento. Cada toma va con su foto o
 * marcada "no se pudo tomar" con un motivo (R70); el tablero exige el km.
 *
 * @param envio { fotos: { [toma]: { ruta, sha256 } | { noSePudo: true, motivo } }, km }
 * @returns lista de errores (vacía si está bien)
 */
export function validarEnvio(envio, tomas = TOMAS_CONDUCTOR) {
  const errores = [];
  const fotos = envio?.fotos || {};
  for (const t of tomas) {
    const f = fotos[t];
    if (!f) errores.push(`falta_${t}`);
    else if (f.noSePudo) {
      if (String(f.motivo || '').trim().length < MOTIVO_MINIMO) errores.push(`motivo_${t}`);
    } else if (!f.ruta || !/^[0-9a-f]{64}$/.test(f.sha256 || '')) errores.push(`foto_${t}`);
  }
  const km = envio?.km === '' || envio?.km == null ? NaN : Number(envio.km);
  if (!Number.isInteger(km) || km < 0 || km > KM_MAXIMO) errores.push('km');
  return errores;
}

/** Ruta en el bucket de fotos: sin RUT ni datos personales (R66). */
export function rutaFoto(patente, uid, toma, fecha = new Date()) {
  const mes = fecha.toISOString().slice(0, 7);
  return `${patente}/${mes}/${uid}-${toma}.jpg`;
}

export const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
