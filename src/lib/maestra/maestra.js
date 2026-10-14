/**
 * Maestra de Control Flota: una fila por auto con su conductor, como la hoja
 * "Vehiculos y ConductoresII" (Name | Vehicles | Rut | Created At | Encargado | Tipo).
 *
 * Se arma con lo que trajeron los exports de Fleet (drivers y vehicles) y
 * encima las correcciones a mano (tabla maestra_ediciones): Fleet trae RUT
 * malos y pierde el coordinador cuando un auto entra a taller. La última
 * corrección de cada campo manda; una corrección vacía vuelve al dato de Fleet.
 *
 * Funciones puras con pruebas en tests/maestra.test.js.
 */
import { rutValido, formatearRut } from '@/lib/rut';
import { normalizarNombre } from '@/lib/fleet/nombres';

export const ENCABEZADOS = ['Name', 'Vehicles', 'Rut', 'Created At', 'Encargado', 'Tipo'];

/** Registros de prueba de Fleet que no son autos. */
export const EXCLUIDOS = ['FAKECAR'];

export const CAMPOS_AUTO = ['encargado', 'tipo'];
export const CAMPOS_CONDUCTOR = ['nombre', 'rut'];
export const TIPOS = ['DTO', 'Renta'];
export const PERDIDA_TOTAL = 'TOTAL LOSS';

const tipoDeModalidad = (m) => (m === 'drive_to_own' ? 'DTO' : m === 'renta' ? 'Renta' : null);

/**
 * Última corrección vigente de cada campo.
 * @param ediciones [{ patente, conductor_id, campo, valor, autor_email, creado }]
 * @returns Map 'auto:PATENTE:campo' | 'conductor:ID:campo' → edición
 */
export function ultimasEdiciones(ediciones) {
  const out = new Map();
  const orden = [...(ediciones || [])].sort((a, b) => String(a.creado).localeCompare(String(b.creado)));
  for (const e of orden) {
    const k = CAMPOS_AUTO.includes(e.campo) ? `auto:${e.patente}:${e.campo}` : `conductor:${e.conductor_id}:${e.campo}`;
    if (e.valor === null || e.valor === '') out.delete(k);
    else out.set(k, e);
  }
  return out;
}

function campo(fleet, edicion) {
  return edicion
    ? { valor: edicion.valor, fleet: fleet ?? null, editado: true, autor: edicion.autor_email, fecha: edicion.creado }
    : { valor: fleet ?? null, fleet: fleet ?? null, editado: false };
}

/**
 * @param autos        [{ patente, estado_fleet, grupo, modalidad }]
 * @param conductores  [{ id, nombre, nombre_fleet, rut, rut_crudo, activacion, creado_fleet, modalidad }]
 * @param vigentes     [{ patente, conductor_id }]  asignaciones abiertas
 * @param anteriores   [{ patente, conductor_id, hasta }]  asignaciones cerradas (para el RUT de un auto sin conductor)
 * @param ediciones    filas de maestra_ediciones
 * @param encargados   { 'J.Varela': 'J. Silva' }  nombre en la hoja de cada grupo de Fleet
 */
export function construirMaestra({ autos, conductores, vigentes, anteriores = [], ediciones = [], encargados = {} }) {
  const porId = new Map((conductores || []).map((c) => [c.id, c]));
  const vigente = new Map((vigentes || []).map((v) => [v.patente, v.conductor_id]));
  const ultimo = new Map();
  for (const a of [...anteriores].sort((x, y) => String(x.hasta).localeCompare(String(y.hasta)))) ultimo.set(a.patente, a.conductor_id);
  const eds = ultimasEdiciones(ediciones);

  return (autos || [])
    .filter((a) => !EXCLUIDOS.includes(a.patente))
    .map((a) => {
      const cId = vigente.get(a.patente) ?? null;
      const c = cId ? porId.get(cId) : null;
      // Un auto sin conductor queda con el RUT del último que lo tuvo, como en la hoja.
      const cRut = c ?? porId.get(ultimo.get(a.patente)) ?? null;
      const ed = (k) => eds.get(k) ?? null;
      const encargado = campo(a.grupo ? (encargados[a.grupo] ?? a.grupo) : null, ed(`auto:${a.patente}:encargado`));

      // Pérdida total: como en la hoja, sin conductor y "TOTAL LOSS" en Rut,
      // Created At y Tipo. Solo el encargado se puede corregir.
      if (a.estado_fleet === 'total_loss') {
        const fijo = { valor: PERDIDA_TOTAL, fleet: PERDIDA_TOTAL, editado: false };
        return {
          patente: a.patente, conductorId: null, conductorRutId: null, estadoFleet: a.estado_fleet,
          nombre: campo(null, null), rut: fijo, creado: PERDIDA_TOTAL, encargado, tipo: fijo,
        };
      }

      return {
        patente: a.patente,
        conductorId: cId,
        conductorRutId: cRut?.id ?? null,
        estadoFleet: a.estado_fleet ?? null,
        nombre: c ? campo(c.nombre_fleet || c.nombre, ed(`conductor:${c.id}:nombre`)) : campo(null, null),
        rut: cRut ? campo(cRut.rut || cRut.rut_crudo, ed(`conductor:${cRut.id}:rut`)) : campo(null, null),
        creado: c?.activacion || c?.creado_fleet || null,
        encargado,
        tipo: campo(tipoDeModalidad(c?.modalidad ?? a.modalidad), ed(`auto:${a.patente}:tipo`)),
      };
    })
    .sort((x, y) => (!x.nombre.valor - !y.nombre.valor) || String(x.nombre.valor ?? x.patente).localeCompare(String(y.nombre.valor ?? y.patente), 'es'));
}

/** Filas para escribir en la hoja de Google, con encabezado. */
export function filasHoja(maestra) {
  return [
    ENCABEZADOS,
    ...maestra.map((f) => [f.nombre.valor ?? '', f.patente, f.rut.valor ?? '', f.creado ?? '', f.encargado.valor ?? '', f.tipo.valor ?? '']),
  ];
}

/**
 * Revisa una corrección antes de guardarla. Valor vacío = volver a Fleet.
 * @returns { valor } (normalizado) o { error }
 */
export function validarEdicion(campoNombre, valor) {
  if (![...CAMPOS_AUTO, ...CAMPOS_CONDUCTOR].includes(campoNombre)) return { error: 'campo' };
  const v = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (!v) return { valor: null };
  if (campoNombre === 'rut') return rutValido(v) ? { valor: formatearRut(v) } : { error: 'rut' };
  if (campoNombre === 'tipo') {
    const t = TIPOS.find((x) => x.toLowerCase() === v.toLowerCase());
    return t ? { valor: t } : { error: 'tipo' };
  }
  if (v.length > (campoNombre === 'nombre' ? 80 : 40)) return { error: 'largo' };
  return { valor: v };
}

const igual = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const mismoRut = (a, b) => String(a ?? '').toUpperCase().replace(/[^0-9K]/g, '') === String(b ?? '').toUpperCase().replace(/[^0-9K]/g, '');

/**
 * Correcciones que ya están hechas a mano en la hoja actual y que la maestra
 * todavía no tiene: sirven para partir sin perder ese trabajo.
 *
 * @param hoja  filas de la hoja como objetos { Name, Vehicles, Rut, Encargado, Tipo }
 * @returns [{ patente?, conductor_id?, campo, valor }]
 */
export function edicionesDesdeHoja(maestra, hoja) {
  const porPatente = new Map(maestra.map((f) => [f.patente, f]));
  const out = [];
  for (const h of hoja || []) {
    const f = porPatente.get(String(h.Vehicles ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    if (!f) continue;
    const enc = String(h.Encargado ?? '').trim();
    if (enc && !igual(enc, f.encargado.valor)) out.push({ patente: f.patente, campo: 'encargado', valor: enc });
    const tipo = validarEdicion('tipo', h.Tipo);
    if (tipo.valor && f.tipo.valor !== PERDIDA_TOTAL && !igual(tipo.valor, f.tipo.valor)) out.push({ patente: f.patente, campo: 'tipo', valor: tipo.valor });
    const rut = String(h.Rut ?? '').trim();
    if (f.conductorRutId && rut && rutValido(rut) && !mismoRut(rut, f.rut.valor)) {
      out.push({ conductor_id: f.conductorRutId, campo: 'rut', valor: formatearRut(rut) });
    }
    const nombre = String(h.Name ?? '').trim().replace(/\s+/g, ' ');
    // Solo diferencias reales: "PPD", tildes o espacios no cuentan como corrección.
    if (f.conductorId && nombre && normalizarNombre(nombre) !== normalizarNombre(f.nombre.valor)) out.push({ conductor_id: f.conductorId, campo: 'nombre', valor: nombre });
  }
  // Un conductor con dos autos aparece dos veces: una corrección por conductor y campo.
  const vistos = new Set();
  return out.filter((e) => {
    const k = `${e.patente ?? e.conductor_id}:${e.campo}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
