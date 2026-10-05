'use client';

/** Colores de cada estado del auto (mismo orden de urgencia que ESTADOS). */
export const COLOR_ESTADO = {
  siniestro: 'bg-red-500/15 text-red-300 border-red-500/40',
  sin_ingreso_taller: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  en_taller: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  entrega_pendiente: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  fotos_ingreso: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  falta_levantamiento: 'bg-yellow-500/10 text-yellow-200 border-yellow-500/30',
  con_conductor: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  disponible: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
  baja: 'bg-zinc-700/30 text-zinc-400 border-zinc-600/40',
};

export function ChipEstado({ estado, t, className = '' }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${COLOR_ESTADO[estado] || COLOR_ESTADO.disponible} ${className}`}>
      {t(`estado_${estado}`)}
    </span>
  );
}

/** Texto de una alerta del auto (ver src/lib/historial/estado.js). */
export function textoAlerta(a, t) {
  if (a.tipo === 'revision_vencida') return t('alerta_revision_vencida')(a.dias);
  if (a.tipo === 'documento_vencido') return t('alerta_documento_vencido')(t(`doc_${a.documento}`), -a.dias);
  if (a.tipo === 'documento_por_vencer') return t('alerta_documento_por_vencer')(t(`doc_${a.documento}`), a.dias);
  if (a.tipo === 'reemplazo') return t('alerta_reemplazo')(a.patente);
  if (a.tipo === 'pendientes') return t('alerta_pendientes')(a.cantidad);
  return t(`alerta_${a.tipo}`);
}

export const fechaCorta = (f) => {
  if (!f) return '—';
  const s = String(f);
  const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const fechaHora = (f) => {
  const s = String(f || '');
  if (s.length <= 10) return fechaCorta(s);
  return new Date(s).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Abre un archivo con URL firmada (las cédulas y actas dejan registro). */
export async function abrirArchivo(id, descargar = false) {
  const r = await fetch(`/api/historial/archivo?id=${id}${descargar ? '&descargar=1' : ''}`);
  const j = await r.json().catch(() => ({}));
  if (j.url) window.open(j.url, '_blank', 'noopener');
  return r.status;
}
