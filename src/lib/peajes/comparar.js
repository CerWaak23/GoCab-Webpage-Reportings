/**
 * Peajes: lo que el GPS registró contra lo que Fleet le cargó a cada conductor.
 *
 * Fleet arma los bills de peaje con el mismo GPS: el bill creado el día D trae
 * las pasadas del día D-1. En un día normal calzan al peso (difieren unos pesos
 * por redondeo). Las diferencias que importan son días sin bill (Fleet no corre
 * los sábados y a veces no lo recupera) y días en que el GPS tiene más o menos
 * pasadas que el bill.
 *
 * Se compara por semana de cobro, igual que el reporte de deudas: el uso de
 * lunes a domingo se cobra el miércoles siguiente. Así un bill que llega un día
 * tarde no aparece como "no cargado" un día y "de más" el siguiente.
 */

/** Desde cuándo se compara: el primer día de uso con bills diarios de Fleet. */
export const COMPARAR_DESDE = '2026-08-12';

const DIA = 86400000;
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const sumarDias = (dia, n) => iso(ms(dia) + n * DIA);

/** Miércoles en que se cobra el uso de ese día (el que sigue al domingo de su semana). */
export function bloqueDe(dia) {
  const dow = new Date(ms(dia)).getUTCDay(); // 0 = domingo
  return sumarDias(dia, ((7 - dow) % 7) + 3);
}
/** Lunes y domingo de uso que cobra un bloque. */
export const usoDelBloque = (bloque) => ({ lunes: sumarDias(bloque, -9), domingo: sumarDias(bloque, -3) });

/**
 * Día de uso de cada bill de peaje. Normalmente D-1. Cuando Fleet no corrió un
 * día y lo recupera al siguiente, ese día salen dos bills por auto (18-10 a las
 * 12:13 y 12:18; 01-11 a las 09:02 y 19:48), uno por cada día. Solo se corre
 * hacia atrás a un día que no tiene bill propio.
 *
 * El orden de creación no dice cuál es cuál: el 01-11 el de las 09:02 era el
 * sábado y el de las 19:48 el viernes que faltó. Con gpsDe(patente, día) cada
 * bill va al día cuyo GPS más se le parece; sin él, el primero es el más viejo.
 *
 * Quedan fuera los ajustes retroactivos (monto sin pasadas: no dicen de qué día
 * son) y los bills en cero, que no cambian nada y desordenarían la asignación.
 */
export function usoDeBills(bills, gpsDe = null) {
  const utiles = bills.filter((b) => Number(b.cruces) > 0);
  const grupos = new Map(); // patente → Map(díaCreación → bills)
  for (const b of utiles) {
    const dia = String(b.creado).slice(0, 10);
    if (!grupos.has(b.patente)) grupos.set(b.patente, new Map());
    const g = grupos.get(b.patente);
    if (!g.has(dia)) g.set(dia, []);
    g.get(dia).push(b);
  }
  const salida = [];
  for (const g of grupos.values()) {
    for (const [creado, lista] of g) {
      lista.sort((a, b) => String(a.creado).localeCompare(String(b.creado)));
      const k = lista.length;
      const usos = lista.map((b, i) => {
        const uso = sumarDias(creado, -1 - (k - 1 - i));
        // Ese día ya tiene su bill (creado al día siguiente): no era una recuperación
        return i < k - 1 && g.has(sumarDias(uso, 1)) ? sumarDias(creado, -1) : uso;
      });
      const dias = [...new Set(usos)];
      if (gpsDe && dias.length === k && k <= 4) {
        const patente = lista[0].patente;
        const costo = (orden) => orden.reduce((s, dia, i) => s + Math.abs((gpsDe(patente, dia) || 0) - Number(lista[i].monto)), 0);
        let mejor = usos;
        for (const orden of permutaciones(dias)) if (costo(orden) < costo(mejor)) mejor = orden;
        mejor.forEach((uso, i) => salida.push({ ...lista[i], uso }));
      } else {
        lista.forEach((b, i) => salida.push({ ...b, uso: usos[i] }));
      }
    }
  }
  return salida;
}

function permutaciones(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]));
}

/** Diferencias de unos pesos son redondeo del GPS: hasta $100 o 1% no cuenta. */
export function estadoDe(gps, fleet) {
  const dif = gps - fleet;
  if (Math.abs(dif) <= Math.max(100, Math.round(gps * 0.01))) return 'ok';
  return dif > 0 ? 'falta' : 'demas';
}

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * @param gpsDias      [{ patente, dia, monto, pasadas }]  suma del GPS por auto y día
 * @param bills        [{ referencia, patente, conductorId, conductor, monto, cruces, creado }]  bills Toll
 * @param asignaciones [{ patente, conductorId, desde, hasta }]
 * @param nombres      Map conductorId → nombre
 * @param encargados   { PATENTE: encargado }
 */
export function compararPeajes({ gpsDias, bills, asignaciones = [], nombres = new Map(), encargados = {}, desde = COMPARAR_DESDE }) {
  const gpsPorDia = new Map(gpsDias.map((g) => [`${g.patente}|${g.dia}`, Number(g.monto) || 0]));
  const conUso = usoDeBills(bills, (patente, dia) => gpsPorDia.get(`${patente}|${dia}`)).filter((b) => b.uso >= desde);
  const maxGps = gpsDias.reduce((m, g) => (g.dia > m ? g.dia : m), '');
  const maxBill = conUso.reduce((m, b) => (b.uso > m ? b.uso : m), '');
  // Hasta donde llegan las dos fuentes: más allá, una de ellas todavía no existe
  const hasta = maxGps && maxBill ? (maxGps < maxBill ? maxGps : maxBill) : null;
  if (!hasta || hasta < desde) return { desde, hasta, bloques: [], filas: [], diasSinBills: [] };

  // Auto y día → lo del GPS y lo de Fleet
  const celdas = new Map();
  const celda = (patente, dia) => {
    const k = `${patente}|${dia}`;
    if (!celdas.has(k)) celdas.set(k, { patente, dia, gps: 0, pasadas: 0, fleet: 0, cruces: 0, bills: [], conductorId: null, conductor: null });
    return celdas.get(k);
  };
  for (const g of gpsDias) {
    if (g.dia < desde || g.dia > hasta) continue;
    const c = celda(g.patente, g.dia);
    c.gps += Number(g.monto) || 0;
    c.pasadas += Number(g.pasadas) || 0;
  }
  for (const b of conUso) {
    if (b.uso > hasta) continue;
    const c = celda(b.patente, b.uso);
    c.fleet += Number(b.monto) || 0;
    c.cruces += Number(b.cruces) || 0;
    c.bills.push(b.referencia);
    if (!c.conductorId && !c.conductor) { c.conductorId = b.conductorId || null; c.conductor = b.conductor || null; }
  }

  // Quién tenía el auto un día sin bill: el del bill más cercano del mismo auto
  // (hasta 3 días, primero hacia atrás); si no hay, la asignación de ese día.
  for (const c of celdas.values()) {
    if (c.conductorId || c.conductor) continue;
    for (let d = 1; d <= 3 && !c.conductorId && !c.conductor; d++) {
      for (const lado of [-d, d]) {
        const v = celdas.get(`${c.patente}|${sumarDias(c.dia, lado)}`);
        if (v && v.bills.length && (v.conductorId || v.conductor)) { c.conductorId = v.conductorId; c.conductor = v.conductor; break; }
      }
    }
    if (!c.conductorId && !c.conductor) {
      const a = asignaciones.find((x) => x.patente === c.patente && x.desde <= c.dia && (!x.hasta || c.dia < x.hasta));
      if (a) c.conductorId = a.conductorId;
    }
  }

  // Conductor y semana de cobro → una fila
  const filas = new Map();
  for (const c of celdas.values()) {
    const clave = c.conductorId ? `id:${c.conductorId}` : c.conductor ? `nom:${normalizar(c.conductor)}` : `auto:${c.patente}`;
    const bloque = bloqueDe(c.dia);
    const k = `${clave}|${bloque}`;
    if (!filas.has(k)) {
      filas.set(k, {
        clave, bloque, conductorId: c.conductorId || null,
        conductor: (c.conductorId && nombres.get(c.conductorId)) || c.conductor || null,
        gps: 0, pasadas: 0, fleet: 0, cruces: 0, dias: [], porAuto: {},
      });
    }
    const f = filas.get(k);
    f.gps += c.gps; f.pasadas += c.pasadas; f.fleet += c.fleet; f.cruces += c.cruces;
    f.porAuto[c.patente] = (f.porAuto[c.patente] || 0) + c.gps + c.fleet;
    f.dias.push({
      dia: c.dia, patente: c.patente, gps: c.gps, pasadas: c.pasadas, fleet: c.fleet, cruces: c.cruces, bills: c.bills,
      nota: c.gps > 0 && !c.bills.length ? 'sin_bill' : c.fleet > 0 && c.gps === 0 ? 'sin_gps' : '',
    });
  }
  const lista = [...filas.values()].map((f) => {
    const patentes = Object.entries(f.porAuto).sort((a, b) => b[1] - a[1]).map(([p]) => p);
    const { porAuto, ...resto } = f;
    return {
      ...resto, patentes, encargado: encargados[patentes[0]] || null,
      dif: f.gps - f.fleet, estado: estadoDe(f.gps, f.fleet),
      dias: f.dias.sort((a, b) => a.dia.localeCompare(b.dia) || a.patente.localeCompare(b.patente)),
    };
  }).sort((a, b) => b.bloque.localeCompare(a.bloque) || Math.abs(b.dif) - Math.abs(a.dif));

  // Semanas de cobro y días en que Fleet no emitió ni un bill para la flota
  const bloques = new Map();
  for (const f of lista) {
    if (!bloques.has(f.bloque)) {
      const { lunes, domingo } = usoDelBloque(f.bloque);
      bloques.set(f.bloque, { bloque: f.bloque, lunes, domingo, completo: domingo <= hasta, gps: 0, fleet: 0, falta: 0, demas: 0, conFalta: 0, conDemas: 0 });
    }
    const b = bloques.get(f.bloque);
    b.gps += f.gps; b.fleet += f.fleet;
    if (f.estado === 'falta') { b.falta += f.dif; b.conFalta++; }
    if (f.estado === 'demas') { b.demas -= f.dif; b.conDemas++; }
  }
  const porDia = new Map();
  for (const c of celdas.values()) {
    const d = porDia.get(c.dia) || { dia: c.dia, gps: 0, fleet: 0 };
    d.gps += c.gps; d.fleet += c.fleet;
    porDia.set(c.dia, d);
  }
  const diasSinBills = [...porDia.values()].filter((d) => d.gps > 0 && d.fleet === 0)
    .map(({ dia, gps }) => ({ dia, gps })).sort((a, b) => a.dia.localeCompare(b.dia));

  return { desde, hasta, bloques: [...bloques.values()].sort((a, b) => b.bloque.localeCompare(a.bloque)), filas: lista, diasSinBills };
}
