import 'server-only';
import { supabaseServidor } from '@/lib/supabase/server';
import { estadoVacio, aplicarArchivos, cerrarReporte, refsDe, consolidarPorDia } from './desdeVersiones';
import { leerCache, guardarCache, diaChile, inicioDiaChile, CODIGO } from '@/lib/historia/cache';

/**
 * Reporte de bills desde la historia en Supabase. Lo usan /api/bills y Despedidos.
 *
 * Repasar toda la historia cada vez tardaba: 14.000 versiones y 7 MB de
 * referencias. Ahora:
 *   1. Si no llegó ningún export desde la última vez, devuelve el resultado
 *      guardado (firma = cuántos exports hay y el último).
 *   2. Si llegó uno, parte de una foto del estado hasta hace 4 semanas y repasa
 *      solo lo posterior. Lo de antes no cambia: queda igual que en la foto.
 *   3. Si la foto ya no calza con la historia (se agregó o borró un export
 *      viejo) o no existe, repasa todo y deja una foto nueva.
 * Las referencias, que solo sirven para descartar las bills que ya no vienen,
 * se piden solo de los dos últimos exports.
 */
const SEMANAS_RECIENTES = 4;
const DIAS_MAX_FOTO = 7 * SEMANAS_RECIENTES + 14; // más vieja que esto, la foto se corre hacia adelante
const VERSION_CACHE = 1;

const COLS_ARCHIVO = 'id, archivo, subido, filas, filas_sin_conductor';
const COLS_VERSION = 'id, referencia, archivo_id, tipo, estado, vehiculo, conductor, telefono, descripcion, monto, pagado, creado_texto';

async function todas(tabla, columnas, filtrar = (q) => q) {
  const sb = supabaseServidor();
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    // Por archivo y, dentro de cada uno, en el orden de las filas del export.
    const { data, error } = await filtrar(sb.from(tabla).select(columnas))
      .order('subido').order(tabla.endsWith('_versiones') ? 'archivo_id' : 'id')
      .order(tabla.endsWith('_versiones') ? 'orden' : 'id').order('id')
      .range(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const firmaDe = (archivos) => `${archivos.length}:${archivos.reduce((m, a) => Math.max(m, a.id), 0)}`;
const diasAntes = (n) => new Date(Date.now() - n * 86400000);

const aEstado = (foto) => ({ ...foto.estado, bills: new Map(foto.estado.bills) });
const aFoto = (estado, hastaDia, firmaAntes) => ({
  version: VERSION_CACHE, codigo: CODIGO, hastaDia, firmaAntes,
  estado: { ...estado, bills: [...estado.bills.entries()] },
});

/**
 * @param opciones.leerResultado  usar el resultado guardado si la firma calza (por defecto sí)
 * @param opciones.leerFoto       partir de la foto de hace 4 semanas (por defecto sí)
 */
export async function reporteDesdeSupabase({ leerResultado = true, leerFoto = true } = {}) {
  const archivosTodos = await todas('bills_archivos', COLS_ARCHIVO);
  if (archivosTodos.length === 0) throw new Error('Supabase no tiene exports de bills');
  const firma = firmaDe(archivosTodos);

  if (leerResultado) {
    const guardado = await leerCache('bills-resultado');
    if (guardado?.version === VERSION_CACHE && guardado.codigo === CODIGO && guardado.firma === firma) return guardado.datos;
  }

  // ¿Sirve la foto? Tiene que existir, ser de esta versión y calzar con los
  // exports anteriores a su día de corte.
  let foto = leerFoto ? await leerCache('bills-foto') : null;
  const antesDe = (dia) => archivosTodos.filter((a) => diaChile(a.subido) < dia);
  if (foto && (foto.version !== VERSION_CACHE || foto.codigo !== CODIGO || firmaDe(antesDe(foto.hastaDia)) !== foto.firmaAntes)) foto = null;

  let estado;
  let desdeDia;
  if (foto) {
    estado = aEstado(foto);
    desdeDia = foto.hastaDia;
  } else {
    estado = estadoVacio();
    desdeDia = null; // toda la historia
  }

  const recientes = desdeDia ? archivosTodos.filter((a) => diaChile(a.subido) >= desdeDia) : archivosTodos;
  const versiones = desdeDia
    ? await todas('bills_versiones', COLS_VERSION, (q) => q.gte('subido', inicioDiaChile(desdeDia)))
    : await todas('bills_versiones', COLS_VERSION);
  const [consolidados, versionesDia] = consolidarPorDia(recientes, versiones);

  // Corte nuevo: hace 4 semanas. Si la foto quedó muy vieja (o no había), se
  // aplica hasta el corte, se guarda la foto, y después se sigue con el resto.
  const corte = diaChile(diasAntes(7 * SEMANAS_RECIENTES));
  const fotoVieja = !desdeDia || desdeDia < diaChile(diasAntes(DIAS_MAX_FOTO));
  if (fotoVieja && corte > (desdeDia || '')) {
    const hasta = consolidados.filter((a) => diaChile(a.subido) < corte);
    aplicarArchivos(estado, hasta, versionesDia);
    await guardarCache('bills-foto', aFoto(estado, corte, firmaDe(antesDe(corte))));
    aplicarArchivos(estado, consolidados.filter((a) => diaChile(a.subido) >= corte), versionesDia);
  } else {
    aplicarArchivos(estado, consolidados, versionesDia);
  }

  // Todos los exports del recorrido (uno por día), para `sources` y para las
  // referencias de los dos últimos
  const [todosConsolidados] = consolidarPorDia(archivosTodos, []);
  const ultimos = todosConsolidados.slice(-2).map((a) => a.id);
  const { data: refs, error } = await supabaseServidor().from('bills_archivos').select('id, archivo, referencias').in('id', ultimos);
  if (error) throw new Error(error.message);
  const conRefs = (a) => a && { ...a, referencias: refs.find((r) => r.id === a.id)?.referencias || [] };
  const n = todosConsolidados.length;
  const datos = cerrarReporte(estado, todosConsolidados, refsDe(conRefs(todosConsolidados[n - 1])), refsDe(conRefs(todosConsolidados[n - 2])));

  await guardarCache('bills-resultado', { version: VERSION_CACHE, codigo: CODIGO, firma, datos });
  return datos;
}
