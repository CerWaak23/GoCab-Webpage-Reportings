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

/**
 * El Balance de cada conductor activo de un export de conductores, para guardar
 * su historia (conductores_balances): Fleet deja el Balance en 0 al despedir, y
 * la renta que debía se saca del último export en que figuraba activo.
 */
export function balancesDeExport(filas) {
  return (filas || [])
    .filter((r) => texto(r['Name']) && !/^fired$/i.test(texto(r['Activation Status'])))
    .map((r) => {
      const nombre = limpiarNombre(r['Name']);
      return {
        rut: rutValido(r['ID Number']) ? formatearRut(r['ID Number']) : null,
        clave_nombre: normalizarNombre(nombre),
        nombre,
        patente: texto(r['Vehicles']).split(/[,\s]+/)[0]?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
        balance: monto(r['Balance']),
        garantia: monto(r['Bail paid']),
      };
    });
}

const DIA = 86400000;
const diaUTC = (iso) => Date.parse(`${iso}T00:00:00Z`);
const isoDe = (t) => new Date(t).toISOString().slice(0, 10);

/** Fecha (AAAA-MM-DD) y hora decimal de un instante, en Chile. */
export function enChile(instante) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instante)).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) + Number(p.minute) / 60 };
}

/**
 * Renta al momento del despido, con la misma lógica que la columna PLAZO del
 * reporte de deudas. Fleet carga la renta de la semana cada miércoles a las
 * 14:00 y cubre de jueves a miércoles.
 *
 *   1. Se parte del último Balance que tuvo como activo (negativo = debe).
 *   2. Se le restan las rentas que Fleet cargó después de ese export y hasta el
 *      día del despido (ese día incluido).
 *   3. Los días de la última semana cargada que no alcanzó a usar se le
 *      descuentan: paga solo los días que tuvo el auto.
 *
 * @param ultimo   { balance, fecha }  fecha = cuándo se subió ese export
 * @param semanal  renta semanal de su auto (sin ella no se prorratea)
 * @param despido  'AAAA-MM-DD'
 * @returns { balanceAlDespido, cargos, diasNoUsados, noUsada, neta }  neta > 0 debe, < 0 a favor
 */
export function rentaAlDespido(ultimo, semanal, despido) {
  const balance = Number(ultimo?.balance) || 0;
  if (!ultimo || !semanal || !/^\d{4}-\d{2}-\d{2}$/.test(String(despido || ''))) {
    return { balanceAlDespido: balance, cargos: 0, diasNoUsados: 0, noUsada: 0, neta: 0 - balance || 0 };
  }
  const desde = enChile(ultimo.fecha);
  const fin = diaUTC(despido);
  let cargos = 0;
  let ultimoMiercoles = null;
  // Del miércoles anterior al export hasta el despido: el último cargado puede ser anterior al export
  for (let t = diaUTC(desde.fecha) - 7 * DIA; t <= fin; t += DIA) {
    if (new Date(t).getUTCDay() !== 3) continue;
    const dia = isoDe(t);
    ultimoMiercoles = t;
    if (dia > desde.fecha || (dia === desde.fecha && desde.hora < 14)) cargos++;
  }
  const balanceAlDespido = balance - cargos * semanal;
  // Cubre de jueves a miércoles: del despido en adelante no lo usó
  const diasUsados = ultimoMiercoles === null ? 7 : Math.round((fin - ultimoMiercoles) / DIA);
  const diasNoUsados = Math.max(0, 7 - diasUsados);
  const noUsada = Math.round((semanal / 7) * diasNoUsados);
  return { balanceAlDespido, cargos, diasNoUsados, noUsada, neta: 0 - balanceAlDespido - noUsada || 0 };
}

/** Casillas que se pueden corregir a mano. */
export const CAMPOS_CAMBIO = ['renta', 'tags', 'multas', 'otros', 'garantia', 'ajustes'];

/**
 * Valores de las casillas con las correcciones a mano: manda la última aprobada
 * de cada casilla. Las pendientes se devuelven aparte: no cuentan hasta que
 * gerencia las apruebe.
 *
 * @param base     { renta, tags, multas, otros, garantia, ajustes } lo calculado
 * @param cambios  filas de despedidos_cambios de este despedido
 */
export function aplicarCambios(base, cambios = []) {
  const valores = { ...base };
  const corregido = {};
  const pendientes = {};
  const orden = [...cambios].sort((a, b) => String(a.propuesto_en).localeCompare(String(b.propuesto_en)));
  for (const c of orden) {
    if (!CAMPOS_CAMBIO.includes(c.campo)) continue;
    if (c.estado === 'aprobado') { valores[c.campo] = c.valor; corregido[c.campo] = c; }
    if (c.estado === 'pendiente') (pendientes[c.campo] ||= []).push(c);
  }
  return { valores, corregido, pendientes };
}

export const BANCOS = [
  'Banco de Chile', 'BancoEstado', 'Santander', 'BCI', 'Scotiabank', 'Itaú', 'BICE', 'Security', 'Banco Falabella',
  'Banco Ripley', 'Consorcio', 'Banco Internacional', 'Coopeuch', 'Tenpo', 'Mercado Pago', 'MACH', 'Prepago Los Héroes', 'Otro',
];
export const TIPOS_CUENTA = ['corriente', 'vista', 'ahorro'];

/**
 * Cuenta bancaria para devolver la garantía. Valida y deja cada dato en limpio.
 * @returns { cuenta } o { error }
 */
export function validarCuenta(c = {}) {
  const titular = texto(c.titular).replace(/\s+/g, ' ').slice(0, 120);
  const numero = texto(c.numero).replace(/[\s.]/g, '');
  const email = texto(c.email).toLowerCase();
  if (titular.length < 3) return { error: 'titular' };
  if (!rutValido(c.rut)) return { error: 'rut' };
  if (!BANCOS.includes(c.banco)) return { error: 'banco' };
  if (!TIPOS_CUENTA.includes(c.tipo)) return { error: 'tipo' };
  if (!/^[0-9-]{4,20}$/.test(numero)) return { error: 'numero' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email' };
  return { cuenta: { titular, rut: formatearRut(c.rut), banco: c.banco, tipo: c.tipo, numero, email: email || null } };
}

/** Lo que ve quien no es gerencia: banco y tipo, el número solo con sus 4 últimos. */
export function enmascararCuenta(c) {
  if (!c) return null;
  return { titular: c.titular, banco: c.banco, tipo: c.tipo, numero: `•••${String(c.numero).slice(-4)}`, enmascarada: true };
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
