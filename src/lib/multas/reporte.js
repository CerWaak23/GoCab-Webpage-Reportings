/**
 * Reporte de multas: lectura de los exports y armado de la deuda y los pagos.
 *
 * Lo usan el reporte (src/app/api/multas/route.js), leyendo la carpeta de
 * Drive o la historia en Supabase (migración 0012), y la carga diaria. Separar
 * la lectura (multasDeFilas) del armado (reporteMultas) permite guardar solo
 * las filas que cambiaron y llegar exactamente al mismo resultado.
 */

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Multas de fiscalización de Carabineros.
 *
 * No hay forma de distinguirlas en el archivo: el sistema no las tipifica y la
 * descripción es texto libre, casi siempre solo el rol de la causa. Adivinar por
 * frases no sirve —de 37 multas, 20 no dicen el motivo—, así que se marcan a mano
 * escribiendo #carabineros en la descripción, en el mismo sistema donde ya se
 * anotan los pagos parciales. Eso sobrevive a cada re-exportación del archivo.
 *
 * Se acepta con o sin tildes y en cualquier caja, porque lo escribe una persona.
 */
// Las vocales van con y sin tilde: lo escribe una persona y "#carabíneros" es un
// typo esperable. Detectar y borrar usan la MISMA expresión, así no puede pasar
// que se reconozca la etiqueta pero quede escrita a la vista.
const RE_CARABINEROS = /#\s*c[aá]r[aá]b[ií]n[eé]r[oó]s/gi;

/**
 * Multas que van a Carabineros sin llevar la etiqueta.
 *
 * Se usa para las que ya ocurrieron: pedirle a alguien que vuelva atrás a editar
 * la descripción de una multa vieja es más frágil que dejarlo escrito acá. De
 * aquí en adelante la vía normal es la etiqueta, y esta lista no debería crecer.
 *
 * La llave es referencia + fecha de la contravención, la misma de fineKey().
 */
const CARABINEROS_FORZADAS = new Set([
  // MARTIN ROJAS, $716.490. Fiscalización de Carabineros: le sacaron el auto por
  // trabajar en aplicaciones de pasajeros.
  '2026-M-9798|2026-08-09',
]);

function esCarabineros(key, descripcion) {
  if (CARABINEROS_FORZADAS.has(key)) return true;
  RE_CARABINEROS.lastIndex = 0; // la bandera /g guarda posición entre llamadas
  return RE_CARABINEROS.test(String(descripcion || ''));
}

// La etiqueta es una marca para el reporte, no parte del motivo: no se muestra.
function sinEtiqueta(descripcion) {
  return clean(String(descripcion || '').replace(RE_CARABINEROS, ''));
}

/**
 * Clave de una multa.
 *
 * En este archivo "Reference" NO es un identificador: es texto libre escrito a
 * mano. "GARANTIA" aparece 10 veces y "MULTA POR VIA EXCLUSIVA" 3, cada una de
 * un conductor distinto. Usarla como llave —como se hace con Bills— fundiría 13
 * filas en 2 y borraría la deuda de 11 personas.
 *
 * Por eso se le suma la fecha de la contravención. Y nada más, porque no queda
 * nada más estable:
 *
 * · el MONTO no entra. El sistema de multas no acepta pagos parciales, así que un
 *   abono se registra bajándole el monto a la multa a mano; con el monto en la
 *   llave esa rebaja se leería como una multa nueva en vez de como un pago.
 * · la PATENTE tampoco. Desde el segundo export viene vacía en todas las filas, y
 *   mientras estuvo en la llave partió en dos la historia de cada multa: la
 *   versión con patente quedó congelada en su monto viejo y arrancó una segunda
 *   con la patente en blanco. Luisa Meza aparecía debiendo $566.490 por la misma
 *   multa contada dos veces, $328.245 y $238.245, cuando debía solo la segunda.
 * · el CONDUCTOR menos: viene vacío en tres de los cinco archivos.
 *
 * Referencia + fecha no repite en ninguno de los 5 archivos (23, 29, 25, 25 y 25
 * filas, cero colisiones). Igual se protege el empate dentro de un mismo archivo,
 * más abajo, para no fundir dos multas en una.
 */
function fineKey(ref, dateContravention) {
  return [clean(ref), clean(dateContravention).slice(0, 10)].join('|');
}

/**
 * Filas de un export de multas → una por multa, con su clave ya resuelta.
 * @returns { formatoDesconocido, encabezado, filas: [{ clave, base, ref, fechaContravencion, cargo, pago, estado, conductor, vehiculo, creado, descripcion }] }
 */
export function multasDeFilas(rows) {
  if (!rows || rows.length < 2) return { vacio: true, formatoDesconocido: false, encabezado: [], filas: [] };
  const header = rows[0].map((h) => String(h).toLowerCase().trim());
  const col = (names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };
  // Por nombre completo: con "incluye", 'amount' calza con 'amount to pay' y
  // 'paid amount', y 'reference' calza con 'bill reference'. Acá eso importa.
  const colExacta = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  /* El export cambió de formato en agosto de 2026 y trae los mismos datos con
     otros nombres. Se aceptan los dos:
       viejo                    nuevo
       reference             →  bill reference   (el "reference" nuevo es otro
                                                  código, el interno de la multa)
       payroll amount        →  amount to pay
       amount                →  paid amount
       driver                →  driver name
       raison + comment      →  description
     El nombre de la columna es lo único de lo que nos podemos colgar, así que
     si el charged no aparece se avisa en vez de emitir ceros silenciosos. */
  const iRef = colExacta(['bill reference']) !== -1 ? colExacta(['bill reference']) : col(['reference', 'ref']);
  const iPayroll = colExacta(['payroll amount', 'amount to pay']);
  const iAmount = colExacta(['amount', 'paid amount']);
  const iStatus = col(['status', 'estado']);
  const iVehicle = col(['vehicle', 'vehículo', 'vehiculo', 'patente']);
  const iDriver = colExacta(['driver name']) !== -1 ? colExacta(['driver name']) : col(['driver', 'conductor']);
  const iComment = colExacta(['comment', 'comentario', 'description']);
  const iReason = colExacta(['raison', 'reason', 'motivo']);
  const iDateCon = col(['date of contravention', 'contravention', 'fecha de infracción']);
  const iCreated = col(['created at', 'created']);

  if (iRef === -1 || iPayroll === -1) {
    return { formatoDesconocido: true, encabezado: rows[0].filter(Boolean).map(String), filas: [] };
  }

  const filas = [];
  const vistasEnArchivo = new Map(); // llave → cuántas veces salió en ESTE archivo
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const ref = iRef >= 0 ? clean(row[iRef]) : '';
    if (!ref) continue;
    const dateCon = iDateCon >= 0 ? clean(row[iDateCon]) : '';
    // Dos multas con la misma referencia y fecha dentro del mismo archivo son
    // dos multas, no una: se les da una llave distinta.
    const base = fineKey(ref, dateCon);
    const repes = (vistasEnArchivo.get(base) || 0) + 1;
    vistasEnArchivo.set(base, repes);
    filas.push({
      clave: repes > 1 ? `${base}#${repes}` : base,
      base,
      ref,
      fechaContravencion: dateCon,
      cargo: parseAmount(iPayroll >= 0 ? row[iPayroll] : 0),
      pago: parseAmount(iAmount >= 0 ? row[iAmount] : 0),
      estado: (iStatus >= 0 ? clean(row[iStatus]) : '').toLowerCase(),
      conductor: iDriver >= 0 ? clean(row[iDriver]) : '',
      vehiculo: iVehicle >= 0 ? clean(row[iVehicle]).toUpperCase() : '',
      creado: iCreated >= 0 ? clean(row[iCreated]) : '',
      descripcion: [iReason >= 0 ? clean(row[iReason]) : '', iComment >= 0 ? clean(row[iComment]) : ''].filter(Boolean).join(' · '),
    });
  }
  return { formatoDesconocido: false, encabezado: [], filas };
}

/**
 * Recorre los exports de más antiguo a más nuevo y arma el reporte.
 * @param archivos [{ name, modifiedTime, formatoDesconocido, encabezado, filas }]
 *   filas: las de multasDeFilas; pueden ser solo las que cambiaron respecto del
 *   archivo anterior: una fila igual a la anterior no cambia nada.
 */
export function reporteMultas(archivos) {
  const finesMap = new Map(); // key → estado más reciente de la multa
  const paymentEvents = []; // pagos detectados al pasar de pending a completed
  const formatosRaros = []; // archivos cuyas columnas no reconocimos

  for (const file of archivos) {
    if (file.formatoDesconocido) {
      formatosRaros.push({ name: file.name, modifiedTime: file.modifiedTime, header: file.encabezado || [] });
      continue;
    }
    for (const f of file.filas) {
      const key = f.clave;
      const prev = finesMap.get(key) || null;
      const cargoArchivo = f.cargo;
      const pagoArchivo = f.pago;
      // Conductor y patente se conservan de la última vez que vinieron: el
      // export los dejó de mandar y no por eso la multa perdió dueño.
      const driver = f.conductor || prev?.driver || '';
      const vehicle = f.vehiculo || prev?.vehicle || '';
      const createdAt = f.creado;

      /* Un pago se detecta de dos maneras, porque el sistema de multas no
         acepta pagos parciales:
         · sube el monto pagado — es el caso limpio, la multa se pagó entera;
         · baja el monto de la multa — es lo que se hace a mano cuando el
           conductor abona una parte: no se puede registrar el abono, así que se
           le rebaja la deuda. Esa rebaja ES el pago.
         Las rebajas se acumulan en `abonos` para que el monto de la multa siga
         siendo el original: si se descontara del cargo, el total facturado
         bajaría solo y el abono no aparecería en ninguna parte. */
      let abonos = prev ? prev.abonos : 0;

      /* La descripción es lo único que puede decir que fue una fiscalización de
         Carabineros. Si en algún archivo vino con la etiqueta, la multa la
         conserva aunque después se reexporte sin ella. */
      const carabineros = esCarabineros(f.base, f.descripcion) || !!prev?.carabineros;
      const tipo = carabineros ? 'Carabineros' : 'Multa';

      if (prev) {
        const subePago = Math.max(0, pagoArchivo - prev._pagoArchivo);
        const bajaCargo = Math.max(0, prev._cargoArchivo - cargoArchivo);
        abonos += bajaCargo;
        const entro = subePago + bajaCargo;
        if (entro > 0) {
          paymentEvents.push({
            reference: key,
            driver: driver || prev.driver,
            vehicle: vehicle || prev.vehicle,
            amount: entro,
            date: file.modifiedTime, // el archivo es lo único que fecha el pago
            type: tipo,
          });
        }
      } else if (pagoArchivo > 0) {
        // Ya venía pagada la primera vez que la vemos: no hay con qué comparar.
        // Se fecha en la creación de la multa, no en la subida del archivo, para
        // no inventar un peak de pagos el día que se cargó el histórico.
        const fecha = createdAt || f.fechaContravencion;
        if (fecha) {
          paymentEvents.push({ reference: key, driver, vehicle, amount: pagoArchivo, date: fecha, type: tipo });
        }
      }

      finesMap.set(key, {
        reference: key,
        refOriginal: f.ref,
        type: tipo,
        carabineros,
        status: f.estado,
        vehicle,
        driver,
        amount: cargoArchivo + abonos, // el cargo original, antes de las rebajas
        paidAmount: pagoArchivo + abonos, // lo pagado, contando las rebajas a mano
        abonos, // cuánto de eso vino por rebaja manual
        _cargoArchivo: cargoArchivo, // lo que dice el archivo hoy, para el próximo diff
        _pagoArchivo: pagoArchivo,
        description: sinEtiqueta(f.descripcion),
        createdAt,
        dateContravention: f.fechaContravencion,
      });
    }
  }

  const fines = Array.from(finesMap.values());

  // Una multa sin conductor ni patente no se puede imputar a nadie: entra en el
  // total facturado pero desaparece de la deuda por conductor, de la tabla de
  // evolución y del filtro por coordinador. Es plata que se esfuma de la vista
  // sin ningún error, así que el reporte tiene que decirlo.
  const dataWarnings = [];
  // Un archivo que no se pudo leer es peor que uno con datos malos: los números
  // quedan viejos y nadie se entera. Ya pasó con el cambio de formato de agosto.
  formatosRaros.forEach((f) => {
    dataWarnings.push({ file: f.name, date: f.modifiedTime, issue: 'unknown_format', columns: f.header.join(', ') });
  });
  const sinDuenio = fines.filter((f) => !f.driver && !f.vehicle);
  if (fines.length && sinDuenio.length / fines.length > 0.2) {
    const ultimo = archivos[archivos.length - 1];
    dataWarnings.push({
      file: ultimo?.name || 'archivo de multas',
      date: ultimo?.modifiedTime || null,
      issue: 'empty_drivers',
      emptyDriverPct: Math.round((sinDuenio.length / fines.length) * 100),
      totalRows: fines.length,
    });
  }

  const totalCharged = fines.reduce((s, f) => s + f.amount, 0);
  const totalPaid = fines.reduce((s, f) => s + f.paidAmount, 0);
  return {
    fines,
    paymentEvents,
    totals: {
      count: fines.length,
      unpaidCount: fines.filter((f) => f.amount - f.paidAmount > 0).length,
      totalCharged,
      totalPaid,
      totalPending: Math.max(0, totalCharged - totalPaid),
    },
    dataWarnings,
  };
}
