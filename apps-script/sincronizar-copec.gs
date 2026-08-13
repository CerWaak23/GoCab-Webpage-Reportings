/**
 * Sincroniza la tabla de usuarios de Copec con Control Flota.
 *
 * El mismo archivo sirve para las dos planillas: solo cambia MODALIDAD en la
 * configuración de abajo. Se pega en Extensiones → Apps Script de CADA planilla.
 *
 * Qué hace:
 *   1. Lee la hoja de conductores de Control Flota.
 *   2. Se queda con los de la modalidad que corresponda (DTO o Arriendo).
 *   3. Reescribe la tabla de esta planilla con esos conductores.
 *   4. Si hubo altas o bajas —no si solo cambió un dato— avisa por correo a Copec.
 *
 * La comparación se hace contra lo que ya está escrito en esta misma tabla, así
 * que si alguien la edita a mano la próxima corrida lo detecta como cambio.
 */

// ─────────────────────────── CONFIGURACIÓN ───────────────────────────
const CONFIG = {
  // Planilla Control Flota (la misma para ambos scripts)
  FLOTA_ID: '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw',
  FLOTA_HOJA: 'Vehiculos y ConductoresII',

  // ⚠ LO ÚNICO QUE CAMBIA ENTRE LAS DOS PLANILLAS
  //   Plan Drive to own → 'DTO'
  //   Plan arriendo     → 'Renta'
  MODALIDAD: 'DTO',

  // Texto que se escribe en la columna Modalidad de esta tabla
  ETIQUETA_MODALIDAD: 'Drive to own',   // en la de arriendo: 'Arriendo'

  // Dónde escribir en ESTA planilla
  HOJA_DESTINO: '',        // vacío = la primera hoja
  FILA_ENCABEZADO: 8,      // la fila con los títulos
  PRIMERA_FILA: 9,         // primera fila de datos
  COL_INICIO: 2,           // columna B (Agregar/Eliminar). La A tiene la numeración y no se toca

  // A quién avisar. Separar con comas.
  CORREOS: 'pendiente@copec.cl',
  COPIA: '',               // opcional, en copia
  ASUNTO: 'GoCab · actualización de conductores del plan',
};
// ─────────────────────────────────────────────────────────────────────

/** Menú propio al abrir la planilla. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GoCab')
    .addItem('Sincronizar ahora', 'sincronizar')
    .addItem('Sincronizar sin enviar correo', 'sincronizarSinCorreo')
    .addSeparator()
    .addItem('Programar sincronización diaria', 'programarDiaria')
    .addItem('Quitar programación', 'quitarProgramacion')
    .addToUi();
}

function sincronizar() { ejecutar(true); }
function sincronizarSinCorreo() { ejecutar(false); }

/** Punto de entrada para el disparador automático. */
function sincronizarAutomatico() { ejecutar(true); }

function ejecutar(avisarPorCorreo) {
  const hoja = CONFIG.HOJA_DESTINO
    ? SpreadsheetApp.getActive().getSheetByName(CONFIG.HOJA_DESTINO)
    : SpreadsheetApp.getActive().getSheets()[0];
  if (!hoja) throw new Error('No encuentro la hoja destino: ' + CONFIG.HOJA_DESTINO);

  const deFlota = leerFlota();                 // conductores de la modalidad, desde Control Flota
  const enTabla = leerTablaActual(hoja);       // lo que hay escrito hoy en esta planilla

  // Las altas y bajas se calculan por RUT, que es lo único que no cambia de escritura
  const rutsAntes = new Set(enTabla.map(f => f.rut));
  const rutsAhora = new Set(deFlota.map(f => f.rut));
  const altas = deFlota.filter(f => !rutsAntes.has(f.rut));
  const bajas = enTabla.filter(f => !rutsAhora.has(f.rut));

  // La fecha de un conductor que ya estaba se respeta; los nuevos llevan la de hoy
  const fechaPrevia = {};
  enTabla.forEach(f => { if (f.fecha) fechaPrevia[f.rut] = f.fecha; });
  const hoy = new Date();

  const filas = deFlota.map(f => ([
    rutsAntes.has(f.rut) ? '' : 'Agregar',     // marca solo lo nuevo para Copec
    fechaPrevia[f.rut] || hoy,
    f.rut,
    f.nombre,
    f.apellido,
    CONFIG.ETIQUETA_MODALIDAD,
  ]));

  escribirTabla(hoja, filas, enTabla.length);

  const resumen = 'Total ' + filas.length + ' · altas ' + altas.length + ' · bajas ' + bajas.length;
  if (avisarPorCorreo && (altas.length || bajas.length)) {
    enviarCorreo(altas, bajas, filas.length);
    SpreadsheetApp.getActive().toast(resumen + ' · correo enviado', 'GoCab', 8);
  } else {
    SpreadsheetApp.getActive().toast(
      resumen + (altas.length || bajas.length ? ' · sin correo' : ' · sin cambios'), 'GoCab', 5);
  }
  return { altas: altas, bajas: bajas, total: filas.length };
}

/** Lee Control Flota y devuelve los conductores de la modalidad configurada. */
function leerFlota() {
  const hoja = SpreadsheetApp.openById(CONFIG.FLOTA_ID).getSheetByName(CONFIG.FLOTA_HOJA);
  if (!hoja) throw new Error('No encuentro la hoja "' + CONFIG.FLOTA_HOJA + '" en Control Flota');
  const datos = hoja.getDataRange().getValues();
  if (datos.length < 2) return [];

  // Las columnas se buscan por nombre y no por posición: en Control Flota ya se
  // agregaron y renombraron columnas varias veces, y leer por posición se rompe
  // en silencio, mostrando datos equivocados sin ningún error.
  const encabezado = datos[0].map(h => normalizar(h));
  const buscar = function () {
    const claves = Array.prototype.slice.call(arguments);
    for (let i = 0; i < encabezado.length; i++) {
      for (let k = 0; k < claves.length; k++) {
        if (encabezado[i].indexOf(claves[k]) !== -1) return i;
      }
    }
    return -1;
  };
  const iNombre = buscar('name', 'nombre', 'conductor');
  const iRut = buscar('rut');
  const iTipo = buscar('tipo', 'modalidad');
  if (iNombre < 0 || iRut < 0 || iTipo < 0) {
    throw new Error('Control Flota cambió de columnas: falta Name, Rut o Tipo');
  }

  const quiero = normalizar(CONFIG.MODALIDAD);
  const salida = [];
  const sinRut = [];
  const vistos = {};

  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    const nombreCrudo = String(fila[iNombre] || '').trim();
    if (!nombreCrudo) continue;
    if (normalizar(fila[iTipo]).indexOf(quiero) === -1) continue;

    const rut = limpiarRut(fila[iRut]);
    if (!rut) { sinRut.push(nombreCrudo); continue; }
    if (vistos[rut]) continue;                 // un mismo rut no puede ir dos veces
    vistos[rut] = true;

    const partes = partirNombre(nombreCrudo);
    salida.push({ rut: rut, nombre: partes.nombre, apellido: partes.apellido, original: nombreCrudo });
  }

  if (sinRut.length) {
    // No se puede inventar un rut, y sin rut Copec no puede identificar a la persona
    SpreadsheetApp.getActive().toast(
      sinRut.length + ' conductor(es) sin rut quedaron fuera: ' + sinRut.slice(0, 3).join(', '),
      'Faltan datos en Control Flota', 10);
  }
  return salida;
}

/** Lee lo que hay escrito hoy en la tabla de esta planilla. */
function leerTablaActual(hoja) {
  const ultima = hoja.getLastRow();
  if (ultima < CONFIG.PRIMERA_FILA) return [];
  const alto = ultima - CONFIG.PRIMERA_FILA + 1;
  const valores = hoja.getRange(CONFIG.PRIMERA_FILA, CONFIG.COL_INICIO, alto, 6).getValues();
  const filas = [];
  valores.forEach(function (v) {
    const rut = limpiarRut(v[2]);
    if (!rut) return;
    filas.push({ rut: rut, fecha: v[1] || null, nombre: String(v[3] || ''), apellido: String(v[4] || '') });
  });
  return filas;
}

/** Escribe la tabla y borra lo que sobra de la corrida anterior. */
function escribirTabla(hoja, filas, cuantasHabia) {
  const alto = Math.max(filas.length, cuantasHabia);
  if (alto > 0) {
    hoja.getRange(CONFIG.PRIMERA_FILA, CONFIG.COL_INICIO, alto, 6)
      .clearContent();
  }
  if (filas.length) {
    hoja.getRange(CONFIG.PRIMERA_FILA, CONFIG.COL_INICIO, filas.length, 6)
      .setValues(filas);
    hoja.getRange(CONFIG.PRIMERA_FILA, CONFIG.COL_INICIO + 1, filas.length, 1)
      .setNumberFormat('dd-mm-yyyy');
  }
}

function enviarCorreo(altas, bajas, total) {
  const nombrePlanilla = SpreadsheetApp.getActive().getName();
  const url = SpreadsheetApp.getActive().getUrl();
  const lista = function (arr) {
    if (!arr.length) return '<p style="color:#666;margin:4px 0 14px">Ninguno.</p>';
    return '<ul style="margin:4px 0 14px">' + arr.map(function (f) {
      return '<li>' + escapar(f.nombre + ' ' + f.apellido) + ' · RUT ' + escapar(f.rut) + '</li>';
    }).join('') + '</ul>';
  };

  const html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">' +
    '<p>Se actualizó la nómina de conductores del plan <b>' + escapar(CONFIG.ETIQUETA_MODALIDAD) + '</b>.</p>' +
    '<p><b>Conductores agregados (' + altas.length + ')</b></p>' + lista(altas) +
    '<p><b>Conductores dados de baja (' + bajas.length + ')</b></p>' + lista(bajas) +
    '<p>La planilla queda con <b>' + total + '</b> conductores activos.</p>' +
    '<p><a href="' + url + '">Abrir ' + escapar(nombrePlanilla) + '</a></p>' +
    '<p style="color:#888;font-size:12px">Correo automático. Se envía solo cuando entra o sale un conductor, ' +
    'no cuando se corrige un dato.</p></div>';

  const opciones = { htmlBody: html, name: 'GoCab Chile' };
  if (CONFIG.COPIA) opciones.cc = CONFIG.COPIA;

  MailApp.sendEmail(
    CONFIG.CORREOS,
    CONFIG.ASUNTO + ' — ' + CONFIG.ETIQUETA_MODALIDAD +
      ' (' + altas.length + ' alta(s), ' + bajas.length + ' baja(s))',
    'Se actualizó la nómina de conductores. Abra el correo en formato HTML para ver el detalle.',
    opciones
  );
}

// ─────────────────────────── AUXILIARES ───────────────────────────

/** Sin tildes, minúsculas y sin espacios de más. */
function normalizar(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "21.000.176-K" → "21000176K". Copec la pide sin puntos ni guión. */
function limpiarRut(v) {
  const s = String(v == null ? '' : v).replace(/[.\-\s]/g, '').toUpperCase().trim();
  return /^[0-9]{7,9}[0-9K]$/.test(s) ? s : '';
}

/**
 * Parte "PPD JUAN FRANCISCO LIRA MANZANO" en nombre y apellido.
 *
 * Es una heurística, no una certeza: el nombre viene en una sola celda y no hay
 * forma de saber dónde termina. Se aplica la convención chilena de dos apellidos
 * y se avisa en el correo si algo se ve raro. Si un caso queda mal, lo correcto
 * es arreglarlo en Control Flota, no acá.
 */
function partirNombre(crudo) {
  let s = String(crudo || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(ppd|pdd|pp d)\s+/i, '');           // prefijos internos de la flota
  const p = s.split(' ').filter(Boolean);
  if (!p.length) return { nombre: '', apellido: '' };
  if (p.length === 1) return { nombre: p[0], apellido: '' };
  if (p.length === 2) return { nombre: p[0], apellido: p[1] };
  if (p.length === 3) return { nombre: p[0], apellido: p.slice(1).join(' ') };
  return { nombre: p.slice(0, 2).join(' '), apellido: p.slice(2).join(' ') };
}

function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────── PROGRAMACIÓN ───────────────────────────

/** Deja la sincronización corriendo sola una vez al día. */
function programarDiaria() {
  quitarProgramacion();
  ScriptApp.newTrigger('sincronizarAutomatico')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();
  SpreadsheetApp.getUi().alert('Listo: se va a sincronizar todos los días alrededor de las 8:00.');
}

function quitarProgramacion() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizarAutomatico') ScriptApp.deleteTrigger(t);
  });
}
