'use client';
/**
 * Borradores en el teléfono (IndexedDB): las fotos y el avance de un
 * levantamiento o revisión sobreviven a un corte de señal o a cerrar el
 * navegador (R74). Las fotos se guardan como Blob, que IndexedDB sí acepta.
 */
const BASE = 'gobills';
const ALMACEN = 'borradores';

function abrir() {
  return new Promise((ok, mal) => {
    const req = indexedDB.open(BASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(ALMACEN);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

async function operar(modo, fn) {
  const db = await abrir();
  try {
    return await new Promise((ok, mal) => {
      const tx = db.transaction(ALMACEN, modo);
      const req = fn(tx.objectStore(ALMACEN));
      tx.oncomplete = () => ok(req?.result);
      tx.onerror = () => mal(tx.error);
    });
  } finally {
    db.close();
  }
}

export const leerBorrador = (clave) => operar('readonly', (s) => s.get(clave)).catch(() => null);
export const guardarBorrador = (clave, valor) => operar('readwrite', (s) => s.put(valor, clave));
export const borrarBorrador = (clave) => operar('readwrite', (s) => s.delete(clave)).catch(() => {});

/** Borradores cuya clave empieza con un prefijo (p. ej. 'acta:'), con su clave. */
export async function listarBorradores(prefijo) {
  try {
    const db = await abrir();
    try {
      return await new Promise((ok, mal) => {
        const tx = db.transaction(ALMACEN, 'readonly');
        const req = tx.objectStore(ALMACEN).openCursor();
        const out = [];
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return ok(out);
          if (String(c.key).startsWith(prefijo)) out.push({ clave: c.key, valor: c.value });
          c.continue();
        };
        req.onerror = () => mal(req.error);
      });
    } finally {
      db.close();
    }
  } catch (_) {
    return [];
  }
}
