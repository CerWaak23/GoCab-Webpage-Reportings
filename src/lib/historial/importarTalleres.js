/**
 * Convierte la pestaña "VEHÍCULOS EN TALLER" de Control Flota en pasos por
 * taller de GoBills. Funciones puras: el script
 * scripts/importar-talleres-control-flota.mjs lee la hoja y escribe.
 *
 * Reglas acordadas con el usuario (2026-10-05):
 *  - "Kaufmann" sin sucursal: siniestro → Kaufmann DyP; el resto → Las Parcelas.
 *  - Sin "tipo de novedad": se deduce del taller (Garantía BAIC → garantía;
 *    Grass → siniestro; el resto → reparación por falla) y queda anotado.
 *  - Quién paga: según el motivo (sugerirPaga). Sin montos.
 *  - EN TALLER / CUSTODIA: paso abierto; la "fecha de egreso" es estimada.
 */
import { normalizarPatente } from '@/lib/patente';
import { sugerirPaga } from './taller';

/** "18/06/2026", "11-09-2026" → "2026-06-18"; "SIN FECHA" → null. */
export function fechaHoja(texto) {
  const m = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(String(texto || ''));
  if (!m) return null;
  const [, d, mes, a] = m;
  const iso = `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const TIPOS = { SINIESTRO: 'siniestro', GARANTIA: 'garantia', 'DANO-USO': 'falla', POLICE: 'falla' };

/** Motivo de la fila: del tipo de novedad o, si falta, deducido del taller. */
export function motivoFila(tipo, tallerTexto) {
  const t = sinTildes(tipo).replace(/\s+/g, '');
  if (TIPOS[t]) return { motivo: TIPOS[t], deducido: false };
  const taller = sinTildes(tallerTexto);
  if (/GARANTIA/.test(taller)) return { motivo: 'garantia', deducido: true };
  if (/GRASS|SINIESTRO/.test(taller)) return { motivo: 'siniestro', deducido: true };
  return { motivo: 'falla', deducido: true };
}

/** Nombre del taller en el catálogo de GoBills (null = "Otro taller"). */
export function tallerFila(texto, motivo) {
  const t = sinTildes(texto);
  if (/KAUF+MANN/.test(t)) return motivo === 'siniestro' ? 'Kaufmann DyP' : 'Kaufmann Las Parcelas';
  if (/INDUMOTORA.*COQUIMBO/.test(t)) return 'Indumotora Santiago Centro';
  if (/INDUMOTORA.*HUECHURABA/.test(t)) return 'Indumotora Huechuraba';
  if (/FULL\s*MEC/.test(t)) return 'FullMec';
  if (/GRASS/.test(t)) return 'Grass Macul';
  if (/GARANTIA\s*BAIC/.test(t)) return 'Garantía BAIC';
  if (/PIAMONTE/.test(t)) return 'Piamonte Santiago Centro';
  return null;
}

/** Talleres de la hoja que no estaban en el catálogo inicial. */
export const TALLERES_NUEVOS = [
  { nombre: 'Garantía BAIC', marca: 'BAIC', para: 'mantencion' },
  { nombre: 'Piamonte Santiago Centro', marca: null, para: 'ambos' },
];

const ABIERTOS = ['EN TALLER', 'CUSTODIA'];
const mediodia = (iso) => (iso ? `${iso}T12:00:00-03:00` : null);

/** Hora de "Ultima Hora de actualización": "10:54" o "17:01   01/10" (hora y día). */
export function horaAvance(texto, fechaPorDefecto) {
  const s = String(texto || '');
  const h = /(\d{1,2}):(\d{2})/.exec(s);
  const d = /(\d{1,2})\/(\d{1,2})(?!\/)/.exec(s.replace(/\d{1,2}:\d{2}/, ''));
  const anio = fechaPorDefecto.slice(0, 4);
  const dia = d ? `${anio}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : fechaPorDefecto;
  const hora = h ? `${h[1].padStart(2, '0')}:${h[2]}` : '12:00';
  return `${dia}T${hora}:00-03:00`;
}

/**
 * Una fila de la hoja → paso por taller. Devuelve { error } si no sirve.
 * @param fila  arreglo con las columnas de la hoja
 * @param n     número de fila en la hoja (para no importarla dos veces)
 * @param fechaAvances 'YYYY-MM-DD' de la columna "Avances dd/mm"
 */
export function pasoDesdeFila(fila, n, fechaAvances) {
  const [patenteTxt, estadoTxt, , ingresoTxt, egresoTxt, tallerTxt, avance, horaTxt, contacto, observaciones, conductorTxt, tipoTxt] =
    fila.map((c) => String(c ?? '').trim());
  const patente = normalizarPatente(patenteTxt);
  let ingreso = fechaHoja(ingresoTxt);
  // Ingreso con año futuro mal tipeado (p. ej. 21/07/2027): se usa el año de la hoja.
  if (ingreso && ingreso > fechaAvances) {
    const corregido = `${fechaAvances.slice(0, 4)}${ingreso.slice(4)}`;
    ingreso = corregido <= fechaAvances ? corregido : ingreso;
  }
  if (!patente) return { error: 'patente', n };
  if (!ingreso) return { error: 'ingreso', n, patente };

  const estado = sinTildes(estadoTxt);
  const abierto = ABIERTOS.includes(estado);
  const egreso = fechaHoja(egresoTxt);
  const { motivo, deducido } = motivoFila(tipoTxt, tallerTxt);
  const taller = tallerFila(tallerTxt, motivo);

  const detalle = {
    taller: taller || 'Otro taller',
    tallerHoja: taller ? undefined : tallerTxt || undefined,
    motivo,
    motivoDeducido: deducido || undefined,
    tipoHoja: tipoTxt || undefined,
    paga: sugerirPaga(motivo),
    ot: null,
    km: null,
    descripcion: [estado === 'CUSTODIA' ? 'En custodia.' : '', observaciones].filter(Boolean).join(' ') || 'Sin observaciones en Control Flota',
    contacto: contacto || undefined,
    ingreso: mediodia(ingreso),
    importado: 'control_flota',
    filaHoja: n,
  };
  if (abierto) {
    detalle.salidaEstimada = egreso || null;
  } else {
    // Año mal tipeado en la hoja (p. ej. 07/08/2028 en un auto que ya salió): se usa el año del ingreso.
    let egresoOk = egreso;
    if (egresoOk && egresoOk > fechaAvances) {
      const corregido = `${ingreso.slice(0, 4)}${egresoOk.slice(4)}`;
      egresoOk = corregido >= ingreso && corregido <= fechaAvances ? corregido : null;
      detalle.egresoHoja = egresoTxt;
    }
    const salida = egresoOk && egresoOk >= ingreso ? egresoOk : ingreso;
    detalle.salida = mediodia(salida);
    detalle.dias = Math.round((Date.parse(salida) - Date.parse(ingreso)) / 86400000);
    detalle.monto = null;
    detalle.factura = null;
    detalle.gasto = null;
    detalle.notaSalida = estado === 'PERDIDA TOTAL' ? 'Pérdida total' : null;
    if (avance) detalle.avanceHoja = avance;
  }

  return {
    patente,
    abierto,
    conductorTexto: conductorTxt || null,
    detalle,
    // En un paso abierto, el avance de la hoja es su primera actualización.
    actualizacion: abierto && avance ? { fecha: horaAvance(horaTxt, fechaAvances), texto: avance } : null,
  };
}
