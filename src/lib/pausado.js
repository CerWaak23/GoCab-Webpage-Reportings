/**
 * Historial de vehículos quedó en pausa (oct-2026): en producción solo va
 * Carga de datos y la maestra de Control Flota. El código sigue en el repo;
 * para retomarlo basta vaciar estas listas.
 */
export const SECCIONES_PAUSADAS = ['historial', 'talleres', 'registros'];

/** Páginas y API del historial y del portal de fotos/actas de conductores. */
export const RUTAS_PAUSADAS = [
  '/historial',
  '/m',
  '/api/historial',
  '/conductores/fotos',
  '/conductores/actas',
  '/api/conductor/fotos',
  '/api/conductor/actas',
];

export const rutaPausada = (pathname) =>
  RUTAS_PAUSADAS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
