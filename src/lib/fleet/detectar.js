/**
 * Columnas que identifican cada export de Fleet. Basta con que estén todas;
 * Fleet puede agregar columnas nuevas sin romper el reconocimiento.
 */
export const COLUMNAS = {
  vehicles: ['Plate Number', 'Vin Code', 'Status', 'Driver'],
  drivers: ['Name', 'ID Number', 'Vehicles', 'Phone Number'],
  bills: ['Reference', 'Type', 'Amount', 'Paid Amount'],
  fines: ['Date of contravention', 'Amount to pay', 'Remaining Amount'],
};

export function detectarTipo(encabezados) {
  const set = new Set((encabezados || []).map((h) => String(h).trim()));
  return Object.keys(COLUMNAS).find((tipo) => COLUMNAS[tipo].every((c) => set.has(c))) || null;
}
