/**
 * Fotos en el teléfono antes de subirlas (KTD7): JPEG de 1600 px de lado
 * mayor, bajo ~300 KB mientras estemos en el plan Free, y su huella SHA-256
 * como evidencia de que no se cambió después.
 */
export const LADO_MAXIMO = 1600;
export const PESO_OBJETIVO = 300 * 1024;

/** Tamaño final manteniendo la proporción; nunca agranda. */
export function dimensionesDestino(ancho, alto, maximo = LADO_MAXIMO) {
  const mayor = Math.max(ancho, alto);
  if (!(mayor > maximo)) return { ancho, alto };
  const f = maximo / mayor;
  return { ancho: Math.round(ancho * f), alto: Math.round(alto * f) };
}

/** Huella SHA-256 en hexadecimal (navegador o Node con WebCrypto). */
export async function sha256Hex(datos) {
  const buf = datos instanceof ArrayBuffer ? datos : await new Response(datos).arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Reduce una imagen (canvas, video o ImageBitmap) a JPEG. Baja la calidad
 * de a poco hasta quedar bajo el peso objetivo. Solo en el navegador.
 */
export async function comprimir(fuente, anchoOriginal, altoOriginal) {
  const { ancho, alto } = dimensionesDestino(anchoOriginal, altoOriginal);
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  canvas.getContext('2d').drawImage(fuente, 0, 0, ancho, alto);
  let blob = null;
  for (const calidad of [0.82, 0.72, 0.62, 0.52]) {
    blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', calidad));
    if (blob && blob.size <= PESO_OBJETIVO) break;
  }
  return { blob, ancho, alto };
}

/** Archivo elegido con la cámara nativa del teléfono → imagen comprimida. */
export async function comprimirArchivo(archivo) {
  const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  try {
    return await comprimir(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}
