import { normalizarNombre } from './nombres';
import { normalizarPatente, leerPatentes } from '@/lib/patente';

/**
 * Encontrar al conductor de una fila cuando los cuatro exports pueden traer
 * errores: el mismo conductor aparece como "PPD Pedro Felipe Bustos C." en un
 * archivo y "Pedro Bustos" en otro, con el teléfono o el RUT mal, o con un
 * homónimo en la flota. Se prueba de lo más seguro a lo menos seguro y, si
 * quedan varios candidatos, se desempata por patente o teléfono. Si aún así
 * hay más de uno, no se adivina: se informa como ambiguo.
 */

const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y']);

export function palabras(nombre) {
  return normalizarNombre(nombre)
    .replace(/[^A-Z ]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !PARTICULAS.has(w));
}

/** Últimos 8 dígitos: el mismo celular con o sin +56 9. */
export function normalizarTelefono(t) {
  const d = String(t ?? '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
}

/** @param conductores [{ id, nombre, telefono?, patentes? }]  (patentes: lista o celda de Fleet) */
export function crearIndice(conductores) {
  return (conductores || []).map((c) => {
    const ps = palabras(c.nombre);
    return {
      id: c.id,
      clave: normalizarNombre(c.nombre),
      palabras: new Set(ps),
      orden: [...ps].sort().join(' '),
      telefono: normalizarTelefono(c.telefono),
      patentes: new Set(Array.isArray(c.patentes) ? c.patentes.map(normalizarPatente) : leerPatentes(c.patentes)),
    };
  });
}

const comunes = (a, b) => [...a].filter((w) => b.has(w)).length;
const contiene = (grande, chico) => chico.size >= 2 && [...chico].every((w) => grande.has(w));

function desempatar(candidatos, ref) {
  if (candidatos.length <= 1) return candidatos;
  const pat = normalizarPatente(ref.patente);
  if (pat) {
    const porPatente = candidatos.filter((c) => c.patentes.has(pat));
    if (porPatente.length === 1) return porPatente;
  }
  const tel = normalizarTelefono(ref.telefono);
  if (tel) {
    const porTel = candidatos.filter((c) => c.telefono === tel);
    if (porTel.length === 1) return porTel;
  }
  return candidatos;
}

/**
 * @param ref { nombre, telefono?, patente? }
 * @returns { id, por } | { ambiguo: true, por } | null
 *   por: 'telefono' | 'nombre' | 'orden' | 'parcial'
 */
export function buscarConductor(ref, indice) {
  const ps = new Set(palabras(ref.nombre));
  const clave = normalizarNombre(ref.nombre);

  // El teléfono vale solo si el nombre no lo contradice (un teléfono mal
  // cargado no puede llevarse la deuda a otra persona).
  const tel = normalizarTelefono(ref.telefono);
  if (tel) {
    const porTel = indice.filter((c) => c.telefono === tel && (ps.size === 0 || comunes(c.palabras, ps) >= 1));
    if (porTel.length === 1) return { id: porTel[0].id, por: 'telefono' };
  }
  if (ps.size === 0) return null;

  const orden = [...ps].sort().join(' ');
  const pasos = [
    ['nombre', (c) => c.clave === clave],
    ['orden', (c) => c.orden === orden],
    ['parcial', (c) => contiene(c.palabras, ps) || contiene(ps, c.palabras)],
  ];
  for (const [por, calza] of pasos) {
    const candidatos = desempatar(indice.filter(calza), ref);
    if (candidatos.length === 1) return { id: candidatos[0].id, por };
    if (candidatos.length > 1) return { ambiguo: true, por };
  }
  return null;
}
