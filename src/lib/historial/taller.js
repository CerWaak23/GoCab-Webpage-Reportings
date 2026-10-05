/**
 * Reglas de Talleres (R56-R60). Funciones puras con pruebas.
 */
import { diasEntre } from './estado';

export const MOTIVOS = ['mantencion', 'falla', 'siniestro', 'garantia'];
export const PAGADORES = ['gocab', 'compania', 'garantia', 'conductor'];
export const ESTADOS_TALLER = ['diagnostico', 'presupuesto', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion', 'listo_retiro'];

/** R58: 3 o más días sin novedades → supervisor; más de 7 → Gerencia y jefes del taller. */
export const DIAS_SUPERVISOR = 3;
export const DIAS_GERENCIA = 7;

/** Marca del auto como la usa el catálogo de talleres. */
export function marcaDelAuto(auto) {
  const t = `${auto?.marca || ''} ${auto?.modelo || ''}`;
  if (/baic/i.test(t)) return 'BAIC';
  if (/neta/i.test(t)) return 'Neta';
  if (/nammi|dongfeng/i.test(t)) return 'Nammi';
  return null;
}

/**
 * Taller sugerido según marca y motivo (protocolo, R56): un siniestro va a
 * un taller "siniestro" o "ambos" de la marca; lo demás a "mantención" o
 * "ambos". Sin uno de la marca, "Otro taller".
 */
export function sugerirTaller(talleres, auto, motivo) {
  const marca = marcaDelAuto(auto);
  const sirve = (t) => (motivo === 'siniestro' ? ['siniestro', 'ambos'] : ['mantencion', 'ambos']).includes(t.para);
  const activos = (talleres || []).filter((t) => t.activo !== false);
  return activos.find((t) => t.marca === marca && sirve(t))
    || activos.find((t) => !t.marca)
    || null;
}

/** Quién paga, según motivo y gravedad del siniestro (leve: conductor; grave: compañía). */
export function sugerirPaga(motivo, gravedad = null) {
  if (motivo === 'garantia') return 'garantia';
  if (motivo === 'siniestro') return gravedad === 'leve' ? 'conductor' : 'compania';
  return 'gocab';
}

/**
 * Escalamiento por días sin actualizaciones (AE7). Cuenta desde la última
 * actualización o, si no hay, desde el ingreso.
 */
export function escalamiento(paso, hoy) {
  const ultima = paso.ultimaActualizacion || paso.ingreso;
  const dias = diasEntre(ultima, hoy);
  if (dias > DIAS_GERENCIA) return { nivel: 'gerencia', dias };
  if (dias >= DIAS_SUPERVISOR) return { nivel: 'supervisor', dias };
  return null;
}

/** Días en taller: desde el ingreso hasta la salida (o hasta hoy si sigue adentro). */
export const diasEnTaller = (ingreso, salida, hoy) => Math.max(0, diasEntre(ingreso, salida || hoy));

const fechaValida = (f) => !Number.isNaN(Date.parse(f || ''));

export function validarIngreso(i) {
  const e = [];
  if (!i?.tallerId) e.push('taller');
  if (!MOTIVOS.includes(i?.motivo)) e.push('motivo');
  if (!PAGADORES.includes(i?.paga)) e.push('paga');
  if (!fechaValida(i?.ingreso)) e.push('ingreso');
  if (i?.km !== '' && i?.km != null && !(Number.isInteger(Number(i.km)) && Number(i.km) >= 0)) e.push('km');
  if (String(i?.descripcion || '').trim().length < 3) e.push('descripcion');
  return e;
}

export function validarActualizacion(a) {
  const e = [];
  if (String(a?.texto || '').trim().length < 3) e.push('texto');
  if (a?.estado && !ESTADOS_TALLER.includes(a.estado)) e.push('estado');
  if (a?.monto != null && a.monto !== '' && !(Number(a.monto) >= 0)) e.push('monto');
  if (a?.estado === 'presupuesto' && (a.monto == null || a.monto === '')) e.push('monto');
  return e;
}

export function validarSalida(s, ingreso) {
  const e = [];
  if (!fechaValida(s?.salida)) e.push('salida');
  else if (ingreso && Date.parse(s.salida) < Date.parse(ingreso)) e.push('salida_antes');
  if (s?.monto != null && s.monto !== '' && !(Number(s.monto) >= 0)) e.push('monto');
  return e;
}

/**
 * Gasto que deja la salida: solo cuando paga GoCab (R59). Con garantía,
 * compañía o conductor no suma a los gastos del auto.
 */
export function gastoDeSalida(paso, salida) {
  if (paso?.paga !== 'gocab' || salida?.monto == null || salida.monto === '') return null;
  return { monto: Number(salida.monto), proveedor: paso.taller, documento: salida.factura || paso.ot || null };
}

/**
 * Autos de reemplazo cuyo auto original no tiene un paso por taller abierto
 * en GoBills (acordado 2026-10-05).
 */
export function reemplazosSinTaller(asignacionesReemplazo, patentesEnTaller) {
  const enTaller = new Set(patentesEnTaller);
  return (asignacionesReemplazo || []).filter((a) => a.reemplaza_patente && !enTaller.has(a.reemplaza_patente));
}
