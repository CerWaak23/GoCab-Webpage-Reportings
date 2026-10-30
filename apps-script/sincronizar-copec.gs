/**
 * Sincroniza la nómina de conductores de Copec con Control Flota.
 *
 * Desde oct-2026 todos los conductores tienen el mismo 15% de descuento, así que
 * hay UNA sola lista: Drive to own y arriendo juntos. Se pega en Extensiones →
 * Apps Script de la planilla que se comparte con Copec.
 *
 * Qué hace:
 *   1. Lee la hoja de conductores de Control Flota ("Vehiculos y ConductoresII",
 *      la que escribe la maestra de GoBills con cada carga de Fleet).
 *   2. Toma a todos los conductores con RUT, sin importar la modalidad.
 *   3. Reescribe la tabla de esta planilla con esos conductores.
 *   4. Si hubo altas o bajas —no si solo cambió un dato— avisa por correo a Copec.
 *
 * La comparación se hace contra la lista del último aviso, guardada en las
 * propiedades del script, no contra la tabla: si la tabla se borra, se ordena o
 * se edita a mano, Copec no recibe la nómina completa como si fueran todos nuevos.
 * Si igual salen demasiadas altas de una vez, no se envía nada solo: la corrida
 * automática lo salta y la manual pide confirmar.
 *
 * Al pasar de dos listas a una: correr una vez "Primera carga (sin marcar ni
 * avisar)" en la planilla que queda, para que los que venían de la otra lista no
 * salgan como altas, y quitar la programación del script en la planilla que se
 * deja de usar, para que no avise sus conductores como bajas.
 */

// ─────────────────────────── CONFIGURACIÓN ───────────────────────────
const CONFIG = {
  // Planilla Control Flota
  FLOTA_ID: '15yNGkyE1kkk8E0yiLLMmahz-G048vwgy2NWN8xYmiFw',
  FLOTA_HOJA: 'Vehiculos y ConductoresII',

  // Columna "Modalidad" de esta tabla. Vacío = la modalidad de cada conductor
  // (Drive to own / Arriendo). Con texto = ese mismo texto para todos.
  ETIQUETA_UNICA: '',
  ETIQUETAS: { dto: 'Drive to own', renta: 'Arriendo' },

  // Dónde escribir en ESTA planilla
  HOJA_DESTINO: '',        // vacío = la primera hoja
  FILA_ENCABEZADO: 8,      // la fila con los títulos
  PRIMERA_FILA: 9,         // primera fila de datos
  COL_INICIO: 2,           // columna B (Agregar/Eliminar). La A tiene la numeración y no se toca

  // A quién avisar. Separar con comas.
  CORREOS: 'jniedmann@copec.cl, bzfernandez@copec.cl',
  COPIA: 'andres.cerda@gocab.io',               // opcional, en copia
  ASUNTO: 'GoCab · actualización de conductores (descuento 15%)',

  // Más altas que esto de una vez huele a error (tabla borrada, hoja cambiada),
  // no a conductores nuevos: en un día normal entran 1 a 5.
  MAX_ALTAS_SIN_CONFIRMAR: 15,
};
// ─────────────────────────────────────────────────────────────────────

/** Menú propio al abrir la planilla. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GoCab')
    .addItem('Sincronizar ahora', 'sincronizar')
    .addItem('Sincronizar sin enviar correo', 'sincronizarSinCorreo')
    .addItem('Primera carga (sin marcar ni avisar)', 'primeraCarga')
    .addSeparator()
    .addItem('Programar sincronización diaria', 'programarDiaria')
    .addItem('Quitar programación', 'quitarProgramacion')
    .addToUi();
}

function sincronizar() { ejecutar({ correo: true, marcar: true, manual: true }); }
function sincronizarSinCorreo() { ejecutar({ correo: false, marcar: true }); }
/** Para unir las dos listas: escribe todo sin marcar "Agregar" ni avisar a Copec. */
function primeraCarga() { ejecutar({ correo: false, marcar: false }); }

/** Punto de entrada para el disparador automático. */
function sincronizarAutomatico() { ejecutar({ correo: true, marcar: true }); }

function ejecutar(op) {
  const hoja = CONFIG.HOJA_DESTINO
    ? SpreadsheetApp.getActive().getSheetByName(CONFIG.HOJA_DESTINO)
    : SpreadsheetApp.getActive().getSheets()[0];
  if (!hoja) throw new Error('No encuentro la hoja destino: ' + CONFIG.HOJA_DESTINO);

  const deFlota = leerFlota();                 // todos los conductores, desde Control Flota
  const enTabla = leerTablaActual(hoja);       // lo que hay escrito hoy en esta planilla
  // Contra qué se compara: la lista del último aviso. Recién instalado no hay,
  // y se usa la tabla, como antes.
  const antes = leerUltimaLista() || enTabla;

  // Las altas y bajas se calculan por RUT, que es lo único que no cambia de escritura
  const rutsAntes = new Set(antes.map(f => f.rut));
  const rutsAhora = new Set(deFlota.map(f => f.rut));
  const altas = deFlota.filter(f => !rutsAntes.has(f.rut));
  const bajas = antes.filter(f => !rutsAhora.has(f.rut));

  if (op.correo && altas.length > CONFIG.MAX_ALTAS_SIN_CONFIRMAR) {
    const aviso = altas.length + ' altas de una vez es raro: puede que la tabla o la lista guardada no sea la de Copec.';
    if (!op.manual) {
      // Sin nadie mirando no se escribe ni se avisa a Copec: queda todo como
      // estaba y solo se le avisa a quien va en copia, para que lo revise.
      console.warn(aviso + ' Corrida automática saltada.');
      const copia = listaCorreos(CONFIG.COPIA);
      if (copia) {
        MailApp.sendEmail(copia, 'Copec: sincronización saltada (' + altas.length + ' altas)',
          aviso + '\n\nNo se avisó a Copec. Abra la planilla y use "Primera carga (sin marcar ni avisar)" ' +
          'si la lista está bien, o "Sincronizar ahora" para enviar igual.\n\n' + SpreadsheetApp.getActive().getUrl(),
          { name: 'GoCab Chile' });
      }
      return { altas: altas, bajas: bajas, total: deFlota.length, saltada: true };
    }
    const ui = SpreadsheetApp.getUi();
    const r = ui.alert('Revisar antes de avisar a Copec',
      aviso + '\n\n¿Enviar igual el correo con las ' + altas.length + ' altas?\n' +
      '(Si no, use "Primera carga" para dejar la lista al día sin avisar.)', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return { altas: altas, bajas: bajas, total: deFlota.length, saltada: true };
  }

  // La fecha de un conductor que ya estaba se respeta; los nuevos llevan la de hoy
  const fechaPrevia = {};
  enTabla.forEach(f => { if (f.fecha) fechaPrevia[f.rut] = f.fecha; });
  const hoy = new Date();

  const filas = deFlota.map(f => ([
    op.marcar && !rutsAntes.has(f.rut) ? 'Agregar' : '',   // marca solo lo nuevo para Copec
    fechaPrevia[f.rut] || hoy,
    f.rut,
    f.nombre,
    f.apellido,
    f.modalidad,
  ]));

  escribirTabla(hoja, filas, enTabla.length);
  guardarUltimaLista(deFlota);

  const resumen = 'Total ' + filas.length + ' · altas ' + altas.length + ' · bajas ' + bajas.length;
  if (op.correo && (altas.length || bajas.length)) {
    enviarCorreo(altas, bajas, filas.length);
    SpreadsheetApp.getActive().toast(resumen + ' · correo enviado', 'GoCab', 8);
  } else {
    SpreadsheetApp.getActive().toast(
      resumen + (altas.length || bajas.length ? ' · sin correo' : ' · sin cambios'), 'GoCab', 5);
  }
  return { altas: altas, bajas: bajas, total: filas.length };
}

/** Lee Control Flota y devuelve todos los conductores con RUT. */
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
  if (iNombre < 0 || iRut < 0) {
    throw new Error('Control Flota cambió de columnas: falta Name o Rut');
  }

  const salida = [];
  const sinRut = [];
  const vistos = {};

  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    const nombreCrudo = String(fila[iNombre] || '').trim();
    if (!nombreCrudo) continue;                // autos sin conductor (en taller, por entregar)

    const rut = limpiarRut(fila[iRut]);
    if (!rut) { sinRut.push(nombreCrudo); continue; }
    if (vistos[rut]) continue;                 // un mismo rut no puede ir dos veces (dos autos)
    vistos[rut] = true;

    const partes = partirNombre(nombreCrudo);
    salida.push({
      rut: rut, nombre: partes.nombre, apellido: partes.apellido, original: nombreCrudo,
      modalidad: etiquetaModalidad(iTipo >= 0 ? fila[iTipo] : ''),
    });
  }

  if (sinRut.length) {
    // No se puede inventar un rut, y sin rut Copec no puede identificar a la persona
    SpreadsheetApp.getActive().toast(
      sinRut.length + ' conductor(es) sin rut quedaron fuera: ' + sinRut.slice(0, 3).join(', '),
      'Faltan datos en Control Flota', 10);
  }
  return salida;
}

function etiquetaModalidad(tipo) {
  if (CONFIG.ETIQUETA_UNICA) return CONFIG.ETIQUETA_UNICA;
  const t = normalizar(tipo);
  if (t.indexOf('dto') !== -1 || t.indexOf('drive') !== -1) return CONFIG.ETIQUETAS.dto;
  if (t.indexOf('renta') !== -1 || t.indexOf('arriendo') !== -1) return CONFIG.ETIQUETAS.renta;
  return '';
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
    '<p>Se actualizó la nómina de conductores de GoCab con <b>descuento del 15%</b>.</p>' +
    '<p><b>Conductores agregados (' + altas.length + ')</b></p>' + lista(altas) +
    '<p><b>Conductores dados de baja (' + bajas.length + ')</b></p>' + lista(bajas) +
    '<p>La planilla queda con <b>' + total + '</b> conductores activos.</p>' +
    '<p><a href="' + url + '">Abrir ' + escapar(nombrePlanilla) + '</a></p>' +
    '<p style="color:#888;font-size:12px">Correo automático. Se envía solo cuando entra o sale un conductor, ' +
    'no cuando se corrige un dato.</p></div>';

  const para = listaCorreos(CONFIG.CORREOS);
  if (!para) throw new Error('No hay destinatarios: revise CORREOS en la configuración.');

  const opciones = { htmlBody: html, name: 'GoCab Chile' };
  const copia = listaCorreos(CONFIG.COPIA);
  if (copia) opciones.cc = copia;

  MailApp.sendEmail(
    para,
    CONFIG.ASUNTO + ' (' + altas.length + ' alta(s), ' + bajas.length + ' baja(s))',
    'Se actualizó la nómina de conductores. Abra el correo en formato HTML para ver el detalle.',
    opciones
  );
}

// ───────────────────── LISTA DEL ÚLTIMO AVISO ─────────────────────
// Una línea "rut|nombre|apellido" por conductor, repartida en trozos porque cada
// propiedad del script admite unos 9 KB.

const CLAVE_LISTA = 'copec_ultima_lista';
const TROZO = 8000;

function leerUltimaLista() {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty(CLAVE_LISTA + '_n') || 0);
  if (!n) return null;
  let texto = '';
  for (let i = 0; i < n; i++) texto += props.getProperty(CLAVE_LISTA + '_' + i) || '';
  return texto.split('\n').filter(Boolean).map(function (l) {
    const p = l.split('|');
    return { rut: p[0], nombre: p[1] || '', apellido: p[2] || '' };
  });
}

function guardarUltimaLista(lista) {
  const props = PropertiesService.getScriptProperties();
  const texto = lista.map(function (f) {
    return [f.rut, f.nombre, f.apellido].map(function (s) { return String(s || '').replace(/[|\n]/g, ' '); }).join('|');
  }).join('\n');
  const viejos = Number(props.getProperty(CLAVE_LISTA + '_n') || 0);
  const valores = {};
  let n = 0;
  for (let i = 0; i < texto.length; i += TROZO) valores[CLAVE_LISTA + '_' + (n++)] = texto.slice(i, i + TROZO);
  valores[CLAVE_LISTA + '_n'] = String(n);
  props.setProperties(valores);
  for (let i = n; i < viejos; i++) props.deleteProperty(CLAVE_LISTA + '_' + i);
}

// ─────────────────────────── AUXILIARES ───────────────────────────

/**
 * Deja la lista de correos como la quiere MailApp: separados por coma y sin nada
 * alrededor. Acepta comas o punto y coma, aguanta espacios y comas colgando, y
 * saca los repetidos. Un espacio de más basta para un "Invalid email", y el error
 * aparece recién al enviar, cuando ya se escribió la planilla.
 */
function listaCorreos(v) {
  const vistos = {};
  return String(v || '')
    .split(/[,;]+/)
    .map(function (c) { return c.trim(); })
    .filter(function (c) {
      if (!c || vistos[c.toLowerCase()]) return false;
      vistos[c.toLowerCase()] = true;
      return true;
    })
    .join(',');
}

/** Sin tildes, minúsculas y sin espacios de más. */
function normalizar(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
 * forma de saber dónde termina. Se aplica la convención chilena de dos apellidos.
 * Si un caso queda mal, lo correcto es arreglarlo en Control Flota (Carga de
 * datos → Maestra), no acá.
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
