import { formatearRut, rutValido } from '@/lib/rut';
import { limpiarNombre, normalizarNombre } from './nombres';

/**
 * Export de conductores despedidos de Fleet. Tiene las mismas columnas que el
 * de conductores, pero todos vienen con "Activation Status" = fired. Por eso se
 * reconoce por las filas y no por los encabezados: confundirlo con el de
 * conductores escribiría a los despedidos en la maestra.
 *
 * Columnas que se usan:
 *   Balance    saldo de la cuenta en Fleet: negativo es renta adeudada, positivo
 *              es renta pagada por adelantado (pagó la semana y lo despidieron)
 *   Bail paid  garantía pagada
 *   Fire Date  fecha de despido
 * La columna Fines no se usa: es el total cargado en multas, no lo que debe.
 */

const texto = (v) => String(v ?? '').trim();
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}/.test(texto(v)) ? texto(v).slice(0, 10) : null);
const monto = (v) => {
  let s = texto(v).replace(/[$\s]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export function esExportDespedidos(filas) {
  const lista = (filas || []).filter((r) => texto(r['Name']));
  return lista.length > 0 && lista.every((r) => /^fired$/i.test(texto(r['Activation Status'])));
}

/** Llave estable de un despedido: su RUT si es válido, si no su nombre normalizado. */
export function claveDespedido(rut, nombre) {
  return rut ? `rut:${rut}` : `nom:${normalizarNombre(nombre)}`;
}

export function leerDespedidos(filas) {
  return (filas || [])
    .filter((r) => texto(r['Name']))
    .map((r) => {
      const rut = rutValido(r['ID Number']) ? formatearRut(r['ID Number']) : null;
      const nombre = limpiarNombre(r['Name']);
      return {
        clave: claveDespedido(rut, nombre),
        rut,
        nombre,
        nombreFleet: texto(r['Name']).replace(/\s+/g, ' '),
        telefono: texto(r['Phone Number']) || null,
        activacion: fecha(r['Activation Date']),
        despido: fecha(r['Fire Date']),
        balance: monto(r['Balance']),
        garantia: monto(r['Bail paid']),
        comentario: texto(r['Comment']).slice(0, 1000) || null,
      };
    });
}

export function resumenDespedidos(despedidos) {
  return {
    total: despedidos.length,
    conRentaAdeudada: despedidos.filter((d) => d.balance < 0).length,
    conRentaAFavor: despedidos.filter((d) => d.balance > 0).length,
    conGarantia: despedidos.filter((d) => d.garantia > 0).length,
    sinRut: despedidos.filter((d) => !d.rut).length,
  };
}

/**
 * Liquidación de un despedido.
 *
 *   Lo que debe: renta adeudada + tags + multas + otros cargos + ajustes del coordinador.
 *   Se cubre primero con la renta que pagó por adelantado, y después con la garantía.
 *   Si la garantía alcanza y sobra, el sobrante se le devuelve. Solo se devuelve
 *   garantía: la renta adelantada que sobre no se devuelve.
 *   Lo que ya se le devolvió de garantía se descuenta de lo que queda por devolver.
 *
 * @param d { balance, garantia }
 * @param c { tags, multas, otros } saldos pendientes de sus boletas y multas
 * @param g { ajustes: [{ monto }], devuelto } lo que registró el coordinador
 */
export function liquidar(d, c = {}, g = {}) {
  const rentaAdeudada = Math.max(0, -(d.balance || 0));
  const rentaAFavor = Math.max(0, d.balance || 0);
  const ajustes = (g.ajustes || []).reduce((a, x) => a + (Number(x.monto) || 0), 0);
  const tags = Math.max(0, c.tags || 0);
  const multas = Math.max(0, c.multas || 0);
  const otros = Math.max(0, c.otros || 0);
  const debe = Math.max(0, rentaAdeudada + tags + multas + otros + ajustes);

  const conRenta = Math.min(debe, rentaAFavor);
  const garantia = Math.max(0, d.garantia || 0);
  const conGarantia = Math.min(debe - conRenta, garantia);
  const nosDebe = debe - conRenta - conGarantia;
  const devuelto = Math.max(0, Number(g.devuelto) || 0);
  const devolver = Math.max(0, garantia - conGarantia - devuelto);

  return { rentaAdeudada, rentaAFavor, tags, multas, otros, ajustes, debe, conRenta, conGarantia, nosDebe, devolver, devuelto };
}

const palabras = (s) => normalizarNombre(s).replace(/^(PPD|PDD|DTO) /, '').split(' ').filter(Boolean);

/**
 * El conductor de una boleta es este despedido si el nombre calza exacto o si
 * todas las palabras de uno están en el otro. Con más de un despedido posible
 * no se asigna a ninguno: es mejor dejarla afuera que cobrársela a otro.
 */
export function asignarPorNombre(despedidos, nombreBoleta) {
  const b = palabras(nombreBoleta);
  if (b.length === 0) return null;
  const exacto = despedidos.filter((d) => palabras(d.nombreFleet || d.nombre).join(' ') === b.join(' '));
  if (exacto.length === 1) return exacto[0];
  if (exacto.length > 1) return null;
  const parcial = despedidos.filter((d) => {
    const p = palabras(d.nombreFleet || d.nombre);
    return p.length >= 2 && b.length >= 2 && (p.every((w) => b.includes(w)) || b.every((w) => p.includes(w)));
  });
  return parcial.length === 1 ? parcial[0] : null;
}
