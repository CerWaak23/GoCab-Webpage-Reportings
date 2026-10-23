/**
 * El mismo resultado que /api/bills arma leyendo la carpeta de Drive, pero a
 * partir de la historia guardada en Supabase (migraciones 0009 y 0010):
 * bills_archivos (un registro por export, en orden) y bills_versiones (una
 * fila por bill cada vez que algo cambió).
 *
 * Replica paso a paso el recorrido de src/app/api/bills/route.js: los pagos
 * son las subidas del pagado entre un archivo y el siguiente, el primer pago
 * de una bill que aparece ya pagada se fecha en su Created At, y al final se
 * descartan las bills que no vienen en el export más nuevo si ese export
 * conserva al menos el 90% de las del anterior. Funciones puras con pruebas.
 *
 * @param archivos   [{ id, archivo, subido, filas, filas_sin_conductor, referencias }] de más antiguo a más nuevo
 * @param versiones  [{ referencia, archivo_id, tipo, estado, vehiculo, conductor, telefono, descripcion, monto, pagado, creado_texto }]
 */
export function reporteDesdeVersiones(archivos, versiones) {
  const estado = aplicarArchivos(estadoVacio(), archivos, versiones);
  return cerrarReporte(estado, archivos, refsDe(archivos[archivos.length - 1]), refsDe(archivos[archivos.length - 2]));
}

/*
 * El recorrido en tres pasos, para poder retomarlo: el estado después de
 * aplicar los exports hasta cierto día se puede guardar y seguir desde ahí con
 * los exports nuevos (lib/bills/supabase.js), en vez de repasar toda la
 * historia cada vez. Aplicar los exports en dos tandas da lo mismo que en una.
 */
export function estadoVacio() {
  return { bills: new Map(), paymentEvents: [], snapshots: [], dataWarnings: [] };
}

export const refsDe = (a) => (a ? { nombre: a.archivo, refs: new Set(a.referencias || []) } : null);

/** Aplica exports, en orden, sobre un estado (lo modifica y lo devuelve). */
export function aplicarArchivos(estado, archivos, versiones) {
  const porArchivo = new Map();
  for (const v of versiones) {
    if (!porArchivo.has(v.archivo_id)) porArchivo.set(v.archivo_id, []);
    porArchivo.get(v.archivo_id).push(v);
  }

  const billsMap = estado.bills;
  const { paymentEvents, snapshots, dataWarnings } = estado;

  for (const a of archivos) {
    const fecha = new Date(a.subido).toISOString();
    for (const v of porArchivo.get(a.id) || []) {
      const prev = billsMap.get(v.referencia) || null;
      const newPaid = Number(v.pagado);
      const newDriver = v.conductor || prev?.driver || '';
      const newVehicle = v.vehiculo || prev?.vehicle || '';
      const newType = v.tipo || '';

      if (prev) {
        const delta = newPaid - prev.paidAmount;
        if (delta > 0) {
          paymentEvents.push({
            reference: v.referencia,
            driver: newDriver || prev.driver,
            vehicle: newVehicle || prev.vehicle,
            amount: delta,
            date: fecha,
            type: newType || prev.type,
          });
        }
      } else if (newPaid > 0 && String(v.creado_texto || '').trim()) {
        paymentEvents.push({
          reference: v.referencia,
          driver: newDriver,
          vehicle: newVehicle,
          amount: newPaid,
          date: String(v.creado_texto).trim(),
          type: newType,
        });
      }

      billsMap.set(v.referencia, {
        reference: v.referencia,
        type: newType,
        status: v.estado || '',
        vehicle: newVehicle,
        driver: newDriver,
        phone: v.telefono || '',
        amount: Number(v.monto),
        paidAmount: newPaid,
        description: v.descripcion || '',
        createdAt: v.creado_texto || '',
      });
    }

    if (a.filas >= 5 && a.filas_sin_conductor / a.filas > 0.8) {
      dataWarnings.push({
        file: a.archivo,
        date: fecha,
        issue: 'empty_drivers',
        emptyDriverPct: Math.round((a.filas_sin_conductor / a.filas) * 100),
        totalRows: a.filas,
      });
    }

    let totalCharged = 0;
    let totalPaid = 0;
    for (const b of billsMap.values()) {
      totalCharged += b.amount;
      totalPaid += b.paidAmount;
    }
    snapshots.push({ date: fecha, name: a.archivo, totalCharged, totalPaid });
  }
  return estado;
}

/**
 * El reporte a partir del estado. Descarta las bills que no vienen en el export
 * más nuevo sobre una copia, para que el estado se pueda seguir usando.
 * @param archivos  todos los exports aplicados, para `sources`
 * @param refsUltimo, refsPenultimo  referencias de los dos últimos (refsDe)
 */
export function cerrarReporte(estado, archivos, refsUltimo, refsPenultimo) {
  const billsMap = new Map(estado.bills);
  const dataWarnings = [...estado.dataWarnings];
  const { paymentEvents, snapshots } = estado;
  let descartadas = 0;
  if (refsUltimo) {
    const anterior = refsPenultimo ? refsPenultimo.refs.size : 0;
    const sobreviven = refsPenultimo ? [...refsPenultimo.refs].filter((r) => refsUltimo.refs.has(r)).length : 0;
    if (!anterior || sobreviven / anterior >= 0.9) {
      for (const ref of [...billsMap.keys()]) {
        if (!refsUltimo.refs.has(ref)) { billsMap.delete(ref); descartadas++; }
      }
    } else {
      dataWarnings.push({ file: refsUltimo.nombre, date: null, issue: 'export_incompleto', refsAhora: refsUltimo.refs.size, refsAnterior: anterior });
    }
  }

  return {
    bills: [...billsMap.values()],
    paymentEvents,
    snapshots,
    dataWarnings,
    sources: archivos.map((a) => a.archivo),
    archivos: { leidos: archivos.length, descartadas },
  };
}

/**
 * Un archivo por día, como el reporte: si ese día se subió el export varias
 * veces, vale el último, y de cada bill la última versión del día. Así los
 * pagos de un día quedan en un solo evento con la hora del último export.
 */
export function consolidarPorDia(archivos, versiones) {
  const dia = (a) => new Date(a.subido).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const ultimoDelDia = new Map();
  for (const a of archivos) ultimoDelDia.set(dia(a), a);
  const destino = new Map(archivos.map((a) => [a.id, ultimoDelDia.get(dia(a))]));

  const porDiaYRef = new Map();
  for (const v of versiones) {
    const a = destino.get(v.archivo_id);
    if (!a) continue;
    porDiaYRef.set(`${a.id}|${v.referencia}`, { ...v, archivo_id: a.id });
  }
  return [[...ultimoDelDia.values()], [...porDiaYRef.values()]];
}
