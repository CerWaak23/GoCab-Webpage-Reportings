import { detectarTipo } from './detectar';
import { leerVehiculos, resumenVehiculos, diferenciasVehiculos } from './vehiculos';
import { leerConductores, resumenConductores } from './conductores';
import { leerBills, leerMultas, resumenBills, resumenMultas } from './cobros';
import { esExportDespedidos, leerDespedidos, resumenDespedidos } from './despedidos';

/**
 * Reconoce un export de Fleet y describe lo que cambiaría, sin escribir nada.
 *
 * @param filas  filas del Excel como objetos (encabezado → valor)
 * @param base   estado actual: { autos, conductores } (ver vehiculos.js y conductores.js)
 * @param hoy    'YYYY-MM-DD'
 */
export function analizarExport(filas, base, hoy) {
  if (!filas || filas.length === 0) return { tipo: null, error: 'vacio' };
  let tipo = detectarTipo(Object.keys(filas[0]));
  if (!tipo) return { tipo: null, error: 'no_reconocido' };
  // Mismas columnas que el de conductores: lo distingue que todos vienen despedidos
  if (tipo === 'drivers' && esExportDespedidos(filas)) tipo = 'despedidos';

  if (tipo === 'despedidos') {
    const despedidos = leerDespedidos(filas);
    return { tipo, datos: despedidos, resumen: resumenDespedidos(despedidos) };
  }

  if (tipo === 'vehicles') {
    const autos = leerVehiculos(filas);
    return { tipo, datos: autos, resumen: resumenVehiculos(autos), diferencias: diferenciasVehiculos(autos, base) };
  }
  if (tipo === 'drivers') {
    const leidos = leerConductores(filas);
    return { tipo, datos: leidos.conductores, resumen: resumenConductores(leidos, base, hoy) };
  }
  if (tipo === 'bills') return { tipo, datos: leerBills(filas), resumen: resumenBills(filas) };
  return { tipo, datos: leerMultas(filas), resumen: resumenMultas(filas) };
}
