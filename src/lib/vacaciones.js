/**
 * Vacaciones del equipo: días hábiles, cruces entre personas y validación de
 * una solicitud. Funciones puras: las usan la API y la pantalla.
 */

/**
 * Feriados de Chile (irrenunciables y movibles ya corridos al lunes que
 * corresponde). Al llegar un año nuevo hay que agregar sus feriados acá.
 */
export const FERIADOS = new Set([
  // 2026
  '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21', '2026-06-21', '2026-06-29', '2026-07-16',
  '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25',
  // 2027
  '2027-01-01', '2027-03-26', '2027-03-27', '2027-05-01', '2027-05-21', '2027-06-21', '2027-06-28', '2027-07-16',
  '2027-08-15', '2027-09-18', '2027-09-19', '2027-10-11', '2027-10-31', '2027-11-01', '2027-12-08', '2027-12-25',
]);

const DIA = 86400000;
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const iso = (t) => new Date(t).toISOString().slice(0, 10);
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(ms(s));

/** Lunes a viernes que no son feriado. */
export function esHabil(dia) {
  const dow = new Date(ms(dia)).getUTCDay();
  return dow !== 0 && dow !== 6 && !FERIADOS.has(dia);
}

/** Días hábiles entre dos fechas, ambas incluidas. */
export function diasHabiles(desde, hasta) {
  if (!esFecha(desde) || !esFecha(hasta) || hasta < desde) return 0;
  let n = 0;
  for (let t = ms(desde); t <= ms(hasta); t += DIA) if (esHabil(iso(t))) n++;
  return n;
}

/** Días hábiles de un período que caen dentro de un año (para el total del año). */
export function diasHabilesEnAnio(desde, hasta, anio) {
  const a = `${anio}-01-01`, b = `${anio}-12-31`;
  const d = desde > a ? desde : a, h = hasta < b ? hasta : b;
  return diasHabiles(d, h);
}

/** Solicitudes que siguen en pie: las rechazadas y canceladas no cuentan. */
export const vigente = (v) => v.estado === 'solicitada' || v.estado === 'aprobada';

/** Las vacaciones de otras personas que se cruzan con un período. */
export function cruces(lista, desde, hasta, email) {
  return lista.filter((v) => vigente(v) && String(v.usuario_email).toLowerCase() !== String(email).toLowerCase()
    && v.desde <= hasta && v.hasta >= desde);
}

/**
 * Lo que ve cada uno: gerencia ve todo; el resto ve las aprobadas de todos y
 * sus propias solicitudes. Una solicitud pendiente no la ven los demás
 * coordinadores hasta que se apruebe.
 */
export function visiblesPara(lista, email, esGerencia) {
  if (esGerencia) return lista;
  const yo = String(email).toLowerCase();
  return lista.filter((v) => v.estado === 'aprobada' || String(v.usuario_email).toLowerCase() === yo);
}

/** Valida una solicitud. @returns { desde, hasta, dias, nota } o { error } */
export function validarSolicitud({ desde, hasta, nota } = {}, hoy) {
  if (!esFecha(desde) || !esFecha(hasta)) return { error: 'fechas' };
  if (hasta < desde) return { error: 'orden' };
  if (hoy && hasta < hoy) return { error: 'pasado' };
  if ((ms(hasta) - ms(desde)) / DIA > 60) return { error: 'largo' };
  const dias = diasHabiles(desde, hasta);
  if (dias === 0) return { error: 'sin_habiles' };
  return { desde, hasta, dias, nota: String(nota || '').trim().slice(0, 300) || null };
}

/** Las semanas (lunes a domingo) de un mes, para el calendario: [[dia|null × 7]] */
export function semanasDelMes(anio, mes) {
  const primero = Date.UTC(anio, mes - 1, 1);
  const ultimo = Date.UTC(anio, mes, 0);
  const desfase = (new Date(primero).getUTCDay() + 6) % 7; // lunes = 0
  const semanas = [];
  let semana = Array(desfase).fill(null);
  for (let t = primero; t <= ultimo; t += DIA) {
    semana.push(iso(t));
    if (semana.length === 7) { semanas.push(semana); semana = []; }
  }
  if (semana.length) semanas.push(semana.concat(Array(7 - semana.length).fill(null)));
  return semanas;
}
