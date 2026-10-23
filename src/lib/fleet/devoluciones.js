import { formatearRut, rutValido } from '@/lib/rut';
import { asignarPorNombre } from './despedidos';

/**
 * Hoja "Devoluciones de Garantia" de Control Flota: una fila por devolución,
 * con la cuenta del conductor (nombre, RUT, banco y número, todo en una celda),
 * el monto, el estado y observaciones. La fila en verde es una devolución hecha;
 * en blanco, pendiente. La columna ESTADO dice lo mismo (ENVIADO / PENDIENTE), y
 * vale cualquiera de las dos.
 */

const texto = (v) => String(v ?? '').trim();

/** Monto de la hoja: "$124.646", "75000", "37.849". */
export function montoDevolucion(v) {
  let s = texto(v).replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * RUTs válidos dentro de la celda de la cuenta. Vienen de todas las formas
 * ("17.518.272-1", "26342268-6", "136784986", pegado al nombre). Un número de
 * cuenta puede parecer RUT; el dígito verificador descarta casi todos, y lo que
 * quede igual tiene que calzar con un despedido para servir.
 */
export function rutsEnTexto(t) {
  const out = new Set();
  for (const m of texto(t).matchAll(/(\d{1,2}\.?\d{3}\.?\d{3})\s*-?\s*([\dkK])(?![\d])/g)) {
    const r = `${m[1]}${m[2]}`;
    if (rutValido(r)) out.add(formatearRut(r));
  }
  return [...out];
}

/** Verde de Sheets (el de "devuelto" es 182,215,168), con margen. */
export function esVerde(color) {
  if (!color) return false;
  const r = Math.round((color.red ?? 1) * 255);
  const g = Math.round((color.green ?? 1) * 255);
  const b = Math.round((color.blue ?? 1) * 255);
  return g > 150 && g - r > 20 && g - b > 20;
}

/**
 * Una fila de la hoja → devolución, o null si es el encabezado o está vacía.
 * @param valores [cuenta, monto, estado, observaciones]
 * @param color   backgroundColor de la primera celda
 */
export function leerFilaDevolucion(valores, color, fila) {
  const [cuenta, monto, estado, obs] = valores.map(texto);
  if (!cuenta || /^cuenta$/i.test(cuenta)) return null;
  const devuelta = esVerde(color) || /^enviad/i.test(estado);
  return {
    fila,
    cuenta,
    nombre: cuenta.split(/\n|rut|,/i)[0].replace(/^titular:\s*/i, '').trim(),
    ruts: rutsEnTexto(cuenta),
    monto: montoDevolucion(monto),
    devuelta,
    estado: estado || (devuelta ? 'ENVIADO' : 'PENDIENTE'),
    observaciones: obs || null,
  };
}

/**
 * Devoluciones de cada despedido: por RUT si la celda trae uno que calce, si no
 * por nombre (cada línea de la celda, la primera que calce con un solo despedido).
 * @returns { porClave: Map(clave → [devolución]), sinAsignar: [devolución] }
 */
export function asignarDevoluciones(devoluciones, despedidos) {
  const porRut = new Map(despedidos.filter((d) => d.rut).map((d) => [d.rut, d]));
  const porClave = new Map();
  const sinAsignar = [];
  for (const dv of devoluciones) {
    let d = dv.ruts.map((r) => porRut.get(r)).find(Boolean);
    if (!d) {
      for (const linea of dv.cuenta.split('\n')) {
        const limpia = linea.replace(/^titular:\s*/i, '').replace(/[\d.,:-]+/g, ' ').trim();
        if (limpia.split(/\s+/).length < 2) continue;
        d = asignarPorNombre(despedidos, limpia);
        if (d) break;
      }
    }
    if (!d) { sinAsignar.push(dv); continue; }
    if (!porClave.has(d.clave)) porClave.set(d.clave, []);
    porClave.get(d.clave).push(dv);
  }
  return { porClave, sinAsignar };
}
