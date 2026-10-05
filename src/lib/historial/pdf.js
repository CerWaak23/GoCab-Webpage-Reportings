import 'server-only';
import { createElement as h } from 'react';
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { itemsChecklist, resumenActa, TOMAS_PROTOCOLO } from './actas';

/**
 * PDF del acta (R14, KTD8): datos, lecturas, checklist, daños, fotos y firma.
 * Va en español: es el documento que recibe el conductor.
 */
const NOMBRE_TOMA = {
  frente: 'Frente', trasera: 'Trasera', lateral_izquierdo: 'Costado izquierdo', lateral_derecho: 'Costado derecho',
  tablero: 'Tablero', esquina_del_izq: 'Esquina delantera izq.', esquina_del_der: 'Esquina delantera der.',
  esquina_tra_izq: 'Esquina trasera izq.', esquina_tra_der: 'Esquina trasera der.', llanta_del_izq: 'Llanta delantera izq.',
  llanta_del_der: 'Llanta delantera der.', llanta_tra_izq: 'Llanta trasera izq.', llanta_tra_der: 'Llanta trasera der.',
  interior_delantero: 'Interior delantero', interior_trasero: 'Interior trasero', maleta: 'Maleta', libre: 'Foto libre',
};
const ESTADO = { ok: 'OK', falta: 'Falta', danado: 'Dañado' };

const s = StyleSheet.create({
  pagina: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  titulo: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 10, color: '#555', marginBottom: 12 },
  seccion: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 6, borderBottom: '1pt solid #ccc', paddingBottom: 3 },
  fila: { flexDirection: 'row', marginBottom: 2 },
  etiqueta: { width: 110, color: '#555' },
  item: { flexDirection: 'row', justifyContent: 'space-between', width: '48%', borderBottom: '0.5pt solid #eee', paddingVertical: 2 },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  foto: { width: '32%', marginBottom: 8 },
  imagen: { width: '100%', height: 118, objectFit: 'cover' },
  pie: { position: 'absolute', bottom: 18, left: 32, right: 32, fontSize: 7, color: '#888', textAlign: 'center' },
  aviso: { color: '#b45309' },
});

const fila = (etiqueta, valor) => h(View, { style: s.fila }, h(Text, { style: s.etiqueta }, etiqueta), h(Text, null, valor ?? '—'));

export async function generarPdfActa({ evento, fotos, firma, checklist }) {
  const d = evento.detalle || {};
  const items = itemsChecklist(checklist);
  const acta = { tipo: evento.tipo, km: d.km, luces: d.luces, checklist: d.checklist, fotos: {} };
  for (const f of fotos) if (f.toma !== 'libre') acta.fotos[f.toma] = { dano: f.metadatos?.dano };
  for (const [t, m] of Object.entries(d.motivos || {})) acta.fotos[t] = { noSePudo: true, motivo: m };
  acta.libres = fotos.filter((f) => f.toma === 'libre').map((f) => ({ comentario: f.metadatos?.comentario }));
  const r = resumenActa(acta, items);

  const fecha = new Date(evento.fecha).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' });
  const titulo = evento.tipo === 'entrega' ? 'Acta de entrega' : 'Acta de recepción';
  const auto = [evento.autos?.marca, evento.autos?.modelo, evento.autos?.anio, evento.autos?.color].filter(Boolean).join(' · ');
  const orden = (f) => (f.toma === 'libre' ? 99 : TOMAS_PROTOCOLO.indexOf(f.toma));

  const doc = h(Document, { title: `${titulo} ${evento.patente}`, author: 'GoCab Chile' },
    h(Page, { size: 'A4', style: s.pagina },
      h(Text, { style: s.titulo }, `${titulo} · ${evento.patente}`),
      h(Text, { style: s.sub }, `${auto || 'Auto'} · ${fecha}`),

      h(Text, { style: s.seccion }, 'Datos'),
      fila('Conductor', evento.conductores?.nombre),
      fila('RUT', evento.conductores?.rut),
      fila('Coordinador', evento.usuario_email),
      fila('Kilometraje', Number.isFinite(d.km) ? `${d.km.toLocaleString('es-CL')} km` : null),
      fila('Luces de advertencia', d.luces ? 'Sí, encendidas' : 'No'),
      d.comentario ? fila('Comentario', d.comentario) : null,

      h(Text, { style: s.seccion }, `Checklist (versión ${evento.checklist_version}) · OK ${r.checklist.ok} · Falta ${r.checklist.falta} · Dañado ${r.checklist.danado}`),
      h(View, { style: s.grilla },
        ...items.map((i) => h(View, { key: i, style: s.item },
          h(Text, null, i),
          h(Text, { style: d.checklist?.[i]?.estado === 'ok' ? null : s.aviso }, ESTADO[d.checklist?.[i]?.estado] || '—')))),

      (r.danos.length || r.sinFoto.length) ? h(Text, { style: s.seccion }, 'Daños y observaciones') : null,
      ...r.danos.map((x, i) => h(Text, { key: `d${i}`, style: s.aviso }, `• ${NOMBRE_TOMA[x.toma] || x.toma}: ${x.texto}`)),
      ...r.sinFoto.map((x, i) => h(Text, { key: `s${i}` }, `• ${NOMBRE_TOMA[x.toma] || x.toma}: no se pudo tomar (${x.motivo})`)),

      h(Text, { style: s.seccion }, 'Firma del conductor'),
      firma ? h(Image, { src: { data: firma, format: 'png' }, style: { width: 180, height: 70, objectFit: 'contain' } }) : h(Text, null, '—'),
      h(Text, { style: { color: '#555', marginTop: 4 } },
        `Firmado en el teléfono del coordinador. Aviso de privacidad aceptado: ${evento.version_aviso || '—'}.`),

      h(Text, { style: s.pie, fixed: true, render: ({ pageNumber, totalPages }) => `GoCab Chile · ${titulo} ${evento.patente} · Página ${pageNumber} de ${totalPages}` })),

    h(Page, { size: 'A4', style: s.pagina },
      h(Text, { style: s.seccion }, 'Fotos'),
      h(View, { style: s.grilla },
        ...[...fotos].filter((f) => f.datos).sort((a, b) => orden(a) - orden(b)).map((f, i) => h(View, { key: i, style: s.foto, wrap: false },
          h(Image, { src: { data: f.datos, format: 'jpg' }, style: s.imagen }),
          h(Text, null, NOMBRE_TOMA[f.toma] || f.toma),
          f.metadatos?.dano ? h(Text, { style: s.aviso }, `Daño: ${f.metadatos.dano}`) : null,
          f.metadatos?.comentario ? h(Text, { style: s.aviso }, f.metadatos.comentario) : null))),
      h(Text, { style: s.pie, fixed: true, render: ({ pageNumber, totalPages }) => `GoCab Chile · ${titulo} ${evento.patente} · Página ${pageNumber} de ${totalPages}` })));

  return renderToBuffer(doc);
}
