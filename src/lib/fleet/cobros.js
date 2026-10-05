const monto = (v) => {
  const n = Number.parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

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
