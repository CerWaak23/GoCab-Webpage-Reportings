import { normalizarPatente } from '@/lib/patente';

const monto = (v) => {
  const n = Number.parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const texto = (v) => String(v ?? '').trim().replace(/\s+/g, ' ') || null;
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '').trim()) ? String(v).trim().slice(0, 10) : null);
const fechaHora = (v) => (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(v ?? '').trim()) ? String(v).trim().slice(0, 19) : fecha(v));
const numeroONull = (v) => (texto(v) === null ? null : monto(v));

/** "BAIC Eu5 (WCRK65)" → "WCRK65"; si no viene entre paréntesis, la celda entera. */
export function patenteDeVehiculo(v) {
  const m = String(v ?? '').match(/\(([^)]+)\)\s*$/);
  return normalizarPatente(m ? m[1] : v) || null;
}

/** Filas del export "bills" → una por referencia (la última si se repite). */
export function leerBills(filas) {
  const porRef = new Map();
  for (const r of filas || []) {
    const referencia = texto(r['Reference']);
    if (!referencia) continue;
    porRef.set(referencia, {
      referencia,
      tipo: texto(r['Type']),
      estado: texto(r['Status']),
      vehiculo: texto(r['Vehicle']),
      patente: patenteDeVehiculo(r['Vehicle']),
      conductor: texto(r['Driver']),
      telefono: texto(r['Phone Number']),
      monto: monto(r['Amount']),
      pagado: monto(r['Paid Amount']),
      cruces: Number.parseInt(r['Total crossings'], 10) || null,
      creado: fechaHora(r['Created At']),
    });
  }
  return [...porRef.values()];
}

/** Filas del export "fines" → una por referencia (la última si se repite). */
export function leerMultas(filas) {
  const porRef = new Map();
  for (const r of filas || []) {
    const referencia = texto(r['Reference']);
    if (!referencia) continue;
    porRef.set(referencia, {
      referencia,
      billReferencia: texto(r['Bill Reference']),
      fecha: fecha(r['Date of contravention']),
      creado: fechaHora(r['Created At']),
      descripcion: texto(r['Description']),
      patente: normalizarPatente(r['Vehicle Number']) || patenteDeVehiculo(r['Vehicle']),
      conductor: texto(r['Driver Name']) || texto(r['Driver']),
      monto: monto(r['Amount to pay']),
      pagado: monto(r['Paid Amount']),
      saldo: monto(r['Remaining Amount']),
      estado: texto(r['Status']),
      lugar: texto(r['Detection Place']),
      velocidad: numeroONull(r['Vehicle Speed']),
      motivoRechazo: texto(r['Reject Reason']),
      encargado: texto(r['Manager']),
      grupo: texto(r['Manager Group']),
    });
  }
  return [...porRef.values()];
}

/** Export "bills" (peajes): cuántos cobros tienen saldo y cuánto suman. */
export function resumenBills(filas) {
  const saldos = (filas || []).map((r) => monto(r['Amount']) - monto(r['Paid Amount'])).filter((s) => s > 0);
  return { total: (filas || []).length, conSaldo: saldos.length, saldo: saldos.reduce((a, s) => a + s, 0) };
}

/** Export "fines" (multas): pendientes y saldo restante. */
export function resumenMultas(filas) {
  const lista = filas || [];
  return {
    total: lista.length,
    pendientes: lista.filter((r) => String(r['Status'] ?? '').trim().toLowerCase() !== 'paid').length,
    saldo: lista.reduce((a, r) => a + monto(r['Remaining Amount']), 0),
  };
}
