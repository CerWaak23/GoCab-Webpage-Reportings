'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n/useLang';
import { BANCOS, TIPOS_CUENTA } from '@/lib/fleet/despedidos';

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const plata = (n) => CLP.format(Math.round(n || 0));
const fechaCorta = (iso) => (iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const quien = (email) => String(email || '').split('@')[0];
const CASILLAS = ['renta', 'tags', 'multas', 'otros', 'ajustes', 'garantia'];

async function pedir(url, cuerpo) {
  const r = await fetch(url, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : { cache: 'no-store' });
  return r.json().catch(() => ({ error: 'red' }));
}

/** Qué falta hacer con un despedido según su resultado: devolver garantía, cobrar (DICOM) o nada. */
const tipoDe = (f) => (f.liquidacion.nosDebe > 0 ? 'dicom' : f.liquidacion.devolver > 0 || f.gestion.cerradoTipo === 'devuelto' ? 'devuelto' : null);
const nPendientes = (f) => Object.values(f.pendientes || {}).reduce((s, xs) => s + xs.length, 0);
const porRevisar = (f) => nPendientes(f) > 0 || (f.gestion.listo && !f.gestion.cerrado);
const peso = (f) => (f.gestion.listo && !f.gestion.cerrado ? 2 : nPendientes(f) > 0 ? 1 : 0);

/**
 * Liquidación de los conductores despedidos. Las casillas se corrigen ahí mismo:
 * lo que corrige gerencia queda al tiro, lo de un coordinador queda pendiente de
 * aprobación. El coordinador marca "Listo" y gerencia confirma que se devolvió o
 * se publicó en DICOM.
 */
export default function Despedidos() {
  const { t } = useLang();
  const [datos, setDatos] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [buscar, setBuscar] = useState('');
  const [abierto, setAbierto] = useState(null);

  const cargar = useCallback(() => pedir('/api/despedidos').then(setDatos), []);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (datos?.filas || []).filter((f) => {
      if (q && !`${f.nombre} ${f.nombreFleet}`.toLowerCase().includes(q)) return false;
      if (filtro === 'deben') return f.liquidacion.nosDebe > 0 && !f.gestion.cerrado;
      if (filtro === 'devolver') return f.liquidacion.devolver > 0;
      if (filtro === 'por_revisar') return porRevisar(f);
      if (filtro === 'cerrados') return f.gestion.cerrado;
      return true;
    }).map((f, i) => ({ f, i }))
      // Arriba lo que espera a gerencia: los listos sin confirmar y después los
      // que tienen cambios por aprobar; el resto, en el orden de la API (despido más nuevo primero).
      .sort((a, b) => peso(b.f) - peso(a.f) || a.i - b.i)
      .map(({ f }) => f);
  }, [datos, filtro, buscar]);

  if (!datos) return <p className="text-sm text-gray-400">{t('dp_cargando')}</p>;
  if (datos.error === 'sin_migracion') return <p className="text-sm text-amber-400">{t('dp_sin_migracion')}</p>;
  // Un error al cargar no es un error al guardar: antes decía "No se pudo guardar"
  // cuando la página no alcanzaba a cargar, y parecía que nada se guardaba.
  if (datos.error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-400">{t('dp_error_cargar')}</p>
        <button type="button" onClick={() => { setDatos(null); cargar(); }}
          className="rounded-lg bg-sky-500 hover:bg-sky-400 text-gray-950 font-semibold text-sm px-4 py-2">{t('dp_reintentar')}</button>
      </div>
    );
  }
  if (datos.filas.length === 0) {
    return (
      <div className="text-sm text-gray-400 space-y-3">
        <p>{t('dp_vacio')}</p>
        <a href="/carga" className="inline-block rounded-lg bg-sky-500 text-gray-950 font-semibold px-4 py-2">{t('dp_ir_carga')}</a>
      </div>
    );
  }

  const todas = datos.filas;
  const deben = todas.filter((f) => f.liquidacion.nosDebe > 0 && !f.gestion.cerrado);
  const devolver = todas.filter((f) => f.liquidacion.devolver > 0);
  const revisar = todas.filter(porRevisar);
  const accion = async (clave, cuerpo) => {
    if (!cuerpo) { await cargar(); return true; } // ya se guardó: solo recargar
    const r = await pedir('/api/despedidos/gestion', { clave, ...cuerpo });
    if (r.error) { alert(t('dp_error_guardar')); return false; }
    await cargar();
    return true;
  };

  return (
    <div className="space-y-5">
      <p className="text-gray-500 text-xs">
        {t('dp_sub')}
        {datos.ultimaCarga && <> · {t('dp_ultima_carga')}: {fechaCorta(datos.ultimaCarga.creado)} ({datos.ultimaCarga.archivo})</>}
      </p>
      {datos.avisos?.map((a) => <p key={a} className="text-xs text-amber-400">{t('dp_aviso_fuente')(a)}</p>)}
      {datos.devolucionesSinAsignar?.length > 0 && (
        <p className="text-xs text-amber-400">
          {t('dp_dev_sin_asignar')(datos.devolucionesSinAsignar.length)}: {datos.devolucionesSinAsignar.map((x) => x.nombre).join(', ')}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tarjeta titulo={t('dp_nos_deben')} valor={plata(deben.reduce((s, f) => s + f.liquidacion.nosDebe, 0))} pie={t('dp_personas')(deben.length)} color="text-red-400" />
        <Tarjeta titulo={t('dp_devolver')} valor={plata(devolver.reduce((s, f) => s + f.liquidacion.devolver, 0))}
          pie={`${t('dp_personas')(devolver.length)} · ${t('dp_ya_devueltas')(todas.filter((f) => f.devolucionEnviada > 0 || f.gestion.cerradoTipo === 'devuelto').length)}`} color="text-emerald-400" />
        <Tarjeta titulo={t('dp_por_revisar')} valor={String(revisar.length)}
          pie={t('dp_por_revisar_pie')(todas.reduce((s, f) => s + nPendientes(f), 0), todas.filter((f) => f.gestion.listo && !f.gestion.cerrado).length)}
          color={revisar.length ? 'text-amber-300' : 'text-gray-400'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {['todos', 'por_revisar', 'deben', 'devolver', 'cerrados'].map((f) => (
          <button key={f} type="button" onClick={() => setFiltro(f)}
            className={`rounded-full border px-3 py-1 text-xs ${filtro === f ? 'border-sky-400 bg-sky-500/15 text-sky-200' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
            {t(`dp_f_${f}`)}
          </button>
        ))}
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder={t('dp_buscar')}
          className="ml-auto w-full sm:w-56 rounded-lg bg-gray-900 border border-gray-700 px-3 py-1.5 text-sm outline-none focus:border-sky-500" />
      </div>
      <p className="text-[11px] text-gray-500">{datos.puedeAprobar ? t('dp_ayuda_gerencia') : t('dp_ayuda_coordinador')}</p>

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">{t('dp_col_nombre')}</th>
              {CASILLAS.map((c) => <th key={c} className="text-right px-3 py-2">{t(`dp_col_${c}`)}</th>)}
              <th className="text-right px-3 py-2">{t('dp_col_saldo')}</th>
              <th className="text-center px-3 py-2">{t('dp_col_listo')}</th>
              <th className="text-center px-3 py-2">{t('dp_col_cerrado')}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <Fragment key={f.clave}>
                <tr className={`border-t border-gray-800 align-top hover:bg-gray-900/50 ${abierto === f.clave ? 'bg-gray-900/70' : ''}`}>
                  <td className="px-3 py-2 cursor-pointer" onClick={() => setAbierto(abierto === f.clave ? null : f.clave)}>
                    <p className="font-medium">{f.nombre}</p>
                    <p className="text-[11px] text-gray-500">{t('dp_despedido')} {fechaCorta(f.despido)}</p>
                  </td>
                  {CASILLAS.map((c) => (
                    <td key={c} className="px-3 py-2 text-right whitespace-nowrap">
                      <Casilla f={f} campo={c} t={t} puedeAprobar={datos.puedeAprobar} onAccion={(cuerpo) => accion(f.clave, cuerpo)} />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right whitespace-nowrap cursor-pointer" onClick={() => setAbierto(abierto === f.clave ? null : f.clave)}><Resultado f={f} t={t} /></td>
                  <td className="px-3 py-2 text-center"><Listo f={f} t={t} onAccion={(cuerpo) => accion(f.clave, cuerpo)} /></td>
                  <td className="px-3 py-2 text-center"><Cerrado f={f} t={t} puede={datos.puedeAprobar} onAccion={(cuerpo) => accion(f.clave, cuerpo)} /></td>
                </tr>
                {abierto === f.clave && (
                  <tr className="bg-gray-900/70"><td colSpan={10} className="px-4 py-4"><Detalle f={f} t={t} puedeAprobar={datos.puedeAprobar} onAccion={(cuerpo) => accion(f.clave, cuerpo)} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tarjeta({ titulo, valor, pie, color }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{titulo}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{valor}</p>
      {pie && <p className="text-xs text-gray-500 mt-1">{pie}</p>}
    </div>
  );
}

/** Lo que se ve en una casilla: la renta puede ser a favor (negativa). */
function Monto({ campo, v, t }) {
  if (campo === 'renta' && v < 0) return <span className="text-emerald-400">{plata(-v)} <span className="text-[10px]">{t('dp_a_favor')}</span></span>;
  if (!v) return <span className="text-gray-600">—</span>;
  return <span className={campo === 'ajustes' && v < 0 ? 'text-emerald-400' : ''}>{plata(v)}</span>;
}

/**
 * Una casilla corregible: clic para editar, Enter para guardar. Muestra si se
 * corrigió a mano (y cuánto decía antes) y las propuestas de coordinadores que
 * esperan aprobación.
 */
function Casilla({ f, campo, t, puedeAprobar, onAccion }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const v = f.valores[campo];
  const corr = f.corregido?.[campo];
  const pend = f.pendientes?.[campo] || [];

  const guardar = async () => {
    const n = Number(String(valor).replace(/[^\d-]/g, ''));
    if (!Number.isFinite(n) || String(valor).trim() === '') return;
    if (n === v) { setEditando(false); return; }
    // Un coordinador confirma antes de mandar: su cambio queda esperando a gerencia
    if (!puedeAprobar && !window.confirm(t('dp_confirmar_cambio')(t(`dp_col_${campo}`), plata(v), plata(n)))) return;
    setOcupado(true);
    const ok = await onAccion({ accion: 'cambio', campo, valor: n, anterior: v });
    setOcupado(false);
    if (ok) setEditando(false);
  };
  const revisar = async (id, aprobar) => { setOcupado(true); await onAccion({ accion: 'revisar', id, aprobar }); setOcupado(false); };

  if (editando) {
    return (
      <input autoFocus value={valor} disabled={ocupado} onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }} onBlur={() => !ocupado && setEditando(false)}
        className="w-24 rounded border border-sky-500/60 bg-gray-950 px-2 py-0.5 text-right text-sm" />
    );
  }
  const tip = corr
    ? t('dp_corregido_por')(quien(corr.propuesto_por), fechaCorta(corr.propuesto_en), plata(f.base[campo]))
    : campo === 'renta' ? tipRenta(f.renta, t) : t('dp_clic_corregir');
  return (
    <div>
      <button type="button" onClick={() => { setValor(String(v ?? 0)); setEditando(true); }} title={tip}
        className={`hover:text-sky-300 ${corr ? 'text-amber-200' : ''}`}>
        <Monto campo={campo} v={v} t={t} />{corr && <span className="ml-1 text-amber-400">●</span>}
      </button>
      {pend.map((p) => (
        <div key={p.id} className="text-[10px] text-amber-300" title={p.nota || ''}>
          {t('dp_propuesto')(plata(p.valor), quien(p.propuesto_por))}
          {puedeAprobar && (
            <>
              <button type="button" disabled={ocupado} onClick={() => revisar(p.id, true)} className="ml-1 text-emerald-400 hover:text-emerald-300" aria-label={t('dp_aprobar')}>✓</button>
              <button type="button" disabled={ocupado} onClick={() => revisar(p.id, false)} className="ml-1 text-red-400 hover:text-red-300" aria-label={t('dp_rechazar')}>✕</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function tipRenta(r, t) {
  if (!r) return '';
  if (r.sinHistorial) return t('dp_renta_sin_historial');
  return t('dp_renta_tip')(plata(r.ultimoBalance), fechaCorta(r.ultimoFecha), r.cargos, plata(r.semanal || 0), r.diasNoUsados, plata(r.noUsada));
}

function Resultado({ f, t }) {
  const l = f.liquidacion;
  const g = f.gestion;
  const pendCF = f.devolucionPendiente > 0
    ? <div className="text-[10px] text-amber-400 font-normal">{t('dp_pendiente_cf')} {plata(f.devolucionPendiente)}</div> : null;
  if (l.nosDebe > 0) {
    return (
      <span className="font-semibold text-red-400">{t('dp_saldo_debe')} {plata(l.nosDebe)}
        {g.cerradoTipo === 'dicom' && <div className="text-[10px] font-normal text-gray-400">✓ {t('dp_publicado')}</div>}{pendCF}
      </span>
    );
  }
  if (g.cerradoTipo === 'devuelto') return <span className="text-gray-400">✓ {t('dp_devuelta')} {plata(g.cerradoMonto)}</span>;
  if (f.devolucionEnviada > 0) {
    return <span className="text-gray-400">✓ {t('dp_devuelta')} {plata(f.devolucionEnviada)}<div className="text-[10px] text-gray-600">{t('dp_en_cf')}</div></span>;
  }
  if (l.devolver > 0) {
    return (
      <span className="font-semibold text-emerald-400">{t('dp_saldo_devolver')} {plata(l.devolver)}{pendCF}
        <div className={`text-[10px] font-normal ${g.cuenta ? 'text-gray-400' : 'text-amber-400'}`}>{g.cuenta ? `🏦 ${t('dp_cuenta_lista')}` : `⚠ ${t('dp_falta_cuenta')}`}</div>
      </span>
    );
  }
  if (l.devuelto > 0) return <span className="text-gray-400">✓ {t('dp_devuelta')}</span>;
  return <span className="text-gray-400">✓ {t('dp_saldo_cero')}</span>;
}

/** El coordinador avisa que está listo para devolver o para publicar en DICOM. */
function Listo({ f, t, onAccion }) {
  const [ocupado, setOcupado] = useState(false);
  const tipo = tipoDe(f);
  const g = f.gestion;
  if (!tipo && !g.listo) return <span className="text-gray-700">—</span>;
  const sinCuenta = tipo === 'devuelto' && !g.cuenta && !g.listo;
  return (
    <label className="inline-flex flex-col items-center gap-0.5 text-[10px] text-gray-400 cursor-pointer"
      title={g.listo ? t('dp_marcado_por')(quien(g.listoPor), fechaCorta(g.listoEn)) : sinCuenta ? t('dp_listo_sin_cuenta') : ''}>
      <input type="checkbox" checked={g.listo} disabled={ocupado || g.cerrado || sinCuenta}
        onChange={async (e) => { setOcupado(true); await onAccion({ accion: 'listo', valor: e.target.checked }); setOcupado(false); }}
        className="w-4 h-4 accent-amber-400" />
      {t(tipo === 'dicom' ? 'dp_listo_dicom' : 'dp_listo_devolver')}
    </label>
  );
}

/** Gerencia confirma que ya se devolvió o que se publicó en DICOM. */
function Cerrado({ f, t, puede, onAccion }) {
  const [ocupado, setOcupado] = useState(false);
  const g = f.gestion;
  const tipo = g.cerradoTipo || tipoDe(f);
  if (!tipo) return <span className="text-gray-700">—</span>;
  const monto = tipo === 'dicom' ? f.liquidacion.nosDebe : f.liquidacion.devolver;
  return (
    <label className={`inline-flex flex-col items-center gap-0.5 text-[10px] ${g.cerrado ? 'text-emerald-300' : 'text-gray-400'} ${puede ? 'cursor-pointer' : ''}`}
      title={g.cerrado ? t('dp_marcado_por')(quien(g.cerradoPor), fechaCorta(g.cerradoEn)) : puede ? '' : t('dp_solo_gerencia_cierra')}>
      <input type="checkbox" checked={g.cerrado} disabled={!puede || ocupado}
        onChange={async (e) => { setOcupado(true); await onAccion({ accion: 'cerrado', valor: e.target.checked, tipo, monto }); setOcupado(false); }}
        className="w-4 h-4 accent-emerald-500" />
      {t(tipo === 'dicom' ? 'dp_cerrado_dicom' : 'dp_cerrado_devuelto')}
    </label>
  );
}

function Detalle({ f, t, puedeAprobar, onAccion }) {
  const l = f.liquidacion;
  const g = f.gestion;
  const [nota, setNota] = useState(g.nota || '');
  const [ocupado, setOcupado] = useState(false);
  const campo = 'rounded-lg bg-gray-950 border border-gray-700 px-2 py-1.5 text-sm outline-none focus:border-sky-500';
  const boton = 'rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-gray-950 font-semibold text-xs px-3 py-1.5';

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{t('dp_detalle_titulo')}</p>
        <dl className="text-sm space-y-1">
          <Linea k={t('dp_col_renta')} v={l.rentaAdeudada} />
          <Linea k={`${t('dp_col_tags')} · ${t('dp_boletas')(f.cobros.nTags)}`} v={l.tags} />
          <Linea k={`${t('dp_col_multas')} · ${f.cobros.nMultas}`} v={l.multas} />
          <Linea k={`${t('dp_col_otros')} · ${t('dp_boletas')(f.cobros.nOtros)}`} v={l.otros} />
          {l.ajustes !== 0 && <Linea k={t('dp_col_ajustes')} v={l.ajustes} />}
          <Linea k={t('dp_det_debe')} v={l.debe} fuerte />
          {l.conRenta > 0 && <Linea k={t('dp_det_renta_favor')} v={-l.conRenta} verde />}
          {l.conGarantia > 0 && <Linea k={t('dp_det_garantia')} v={-l.conGarantia} verde />}
          {l.nosDebe > 0 && <Linea k={t('dp_det_queda')} v={l.nosDebe} fuerte rojo />}
          {f.valores.garantia - l.conGarantia > 0 && <Linea k={t('dp_det_sobra')} v={f.valores.garantia - l.conGarantia} />}
          {l.devuelto > 0 && <Linea k={t('dp_det_ya_devuelto')} v={-l.devuelto} />}
          {l.devolver > 0 && <Linea k={t('dp_saldo_devolver')} v={l.devolver} fuerte verde />}
        </dl>
        <p className="mt-2 text-[11px] text-gray-500">{tipRenta(f.renta, t)}</p>
        {f.devoluciones?.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{t('dp_dev_titulo')}</p>
            {f.devoluciones.map((x) => (
              <p key={x.fila} className="text-xs text-gray-300">
                <span className={x.devuelta ? 'text-emerald-400' : 'text-amber-400'}>{x.devuelta ? '✓ ' + t('dp_dev_enviada') : '⏳ ' + t('dp_dev_pendiente')}</span>
                {' '}{plata(x.monto)} <span className="text-gray-600">· {t('dp_dev_fila')} {x.fila}</span>
                {x.observaciones && <span className="text-gray-500"> · {x.observaciones}</span>}
              </p>
            ))}
          </div>
        )}
        {f.comentario && (
          <p className="mt-3 text-xs text-gray-500 whitespace-pre-line"><span className="text-gray-400">{t('dp_comentario_fleet')}:</span> {f.comentario}</p>
        )}
      </div>

      <div className="space-y-5">
        {(l.devolver > 0 || g.cuenta || g.cerradoTipo === 'devuelto') && <Cuenta f={f} t={t} puedeAprobar={puedeAprobar} onAccion={onAccion} />}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{t('dp_nota_titulo')}</p>
          <div className="flex gap-2">
            <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} className={`${campo} flex-1`} />
            <button type="button" className={`${boton} self-start`} disabled={ocupado || nota === (g.nota || '')}
              onClick={async () => { setOcupado(true); await onAccion({ accion: 'nota', texto: nota }); setOcupado(false); }}>{t('dp_guardar')}</button>
          </div>
        </div>
        {f.historial?.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{t('dp_historial')}</p>
            <ul className="text-xs space-y-0.5">
              {[...f.historial].reverse().map((h) => (
                <li key={h.id} className="text-gray-400">
                  <span className="text-gray-200">{t(`dp_col_${h.campo}`)}</span> {h.anterior != null && `${plata(h.anterior)} → `}{plata(h.valor)}
                  <span className={h.estado === 'aprobado' ? 'text-emerald-400' : h.estado === 'pendiente' ? 'text-amber-300' : 'text-red-400'}> · {t(`dp_estado_${h.estado}`)}</span>
                  <span className="text-gray-600"> · {quien(h.por)} {fechaCorta(h.en)}{h.nota ? ` · ${h.nota}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cuenta bancaria para devolverle la garantía. La ingresa el coordinador; la
 * cuenta completa solo la ve gerencia (al resto la API la manda enmascarada).
 */
function Cuenta({ f, t, puedeAprobar, onAccion }) {
  const g = f.gestion;
  const vacia = { titular: '', rut: '', banco: '', tipo: '', numero: '', email: '' };
  const [editando, setEditando] = useState(!g.cuenta);
  const [c, setC] = useState(g.cuenta && !g.cuenta.enmascarada ? { ...vacia, ...g.cuenta, email: g.cuenta.email || '' } : vacia);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const campo = 'rounded-lg bg-gray-950 border border-gray-700 px-2 py-1.5 text-sm outline-none focus:border-sky-500';
  const cambiar = (k) => (e) => setC({ ...c, [k]: e.target.value });

  async function guardar() {
    if (!puedeAprobar && !window.confirm(t('dp_confirmar_cuenta')(f.nombre))) return;
    setOcupado(true);
    const r = await fetch('/api/despedidos/gestion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: f.clave, accion: 'cuenta', cuenta: c }),
    }).then((x) => x.json()).catch(() => ({ error: 'red' }));
    setOcupado(false);
    if (r.error) {
      const k = `dp_cuenta_error_${r.error}`;
      setError(t(k) === k ? t('dp_error_guardar') : t(k));
      return;
    }
    setError(null);
    setEditando(false);
    await onAccion(null);
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{t('dp_cuenta_titulo')}</p>
      {!editando && g.cuenta ? (
        <div className="mt-1 text-sm text-gray-200 space-y-0.5">
          <p>{g.cuenta.titular}{g.cuenta.rut && <span className="text-gray-400"> · {g.cuenta.rut}</span>}</p>
          <p>{g.cuenta.banco} · {t(`dp_cuenta_tipo_${g.cuenta.tipo}`)} · <span className="font-mono">{g.cuenta.numero}</span></p>
          {g.cuenta.email && <p className="text-gray-400">{g.cuenta.email}</p>}
          <p className="text-[10px] text-gray-600">{t('dp_marcado_por')(quien(g.cuentaPor), fechaCorta(g.cuentaEn))}{g.cuenta.enmascarada && ` · ${t('dp_cuenta_solo_gerencia')}`}</p>
          <button type="button" onClick={() => { setC(g.cuenta.enmascarada ? vacia : { ...vacia, ...g.cuenta, email: g.cuenta.email || '' }); setEditando(true); }}
            className="text-xs text-sky-300 hover:text-sky-200">{t('dp_cuenta_editar')}</button>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input placeholder={t('dp_cuenta_titular')} value={c.titular} onChange={cambiar('titular')} className={`${campo} col-span-2`} />
          <input placeholder={t('dp_cuenta_rut')} value={c.rut} onChange={cambiar('rut')} className={campo} />
          <select value={c.banco} onChange={cambiar('banco')} className={campo}>
            <option value="">{t('dp_cuenta_banco')}</option>
            {BANCOS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={c.tipo} onChange={cambiar('tipo')} className={campo}>
            <option value="">{t('dp_cuenta_tipo')}</option>
            {TIPOS_CUENTA.map((x) => <option key={x} value={x}>{t(`dp_cuenta_tipo_${x}`)}</option>)}
          </select>
          <input placeholder={t('dp_cuenta_numero')} value={c.numero} onChange={cambiar('numero')} inputMode="numeric" className={campo} />
          <input placeholder={t('dp_cuenta_email')} value={c.email} onChange={cambiar('email')} type="email" className={`${campo} col-span-2`} />
          <div className="col-span-2 flex items-center gap-2">
            <button type="button" disabled={ocupado} onClick={guardar}
              className="rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-gray-950 font-semibold text-xs px-3 py-1.5">{t('dp_guardar')}</button>
            {g.cuenta && <button type="button" onClick={() => setEditando(false)} className="text-xs text-gray-400 hover:text-white">{t('ma_cancelar')}</button>}
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Linea({ k, v, fuerte, verde, rojo }) {
  return (
    <div className={`flex justify-between gap-4 ${fuerte ? 'font-semibold border-t border-gray-800 pt-1' : ''}`}>
      <dt className="text-gray-400">{k}</dt>
      <dd className={verde ? 'text-emerald-400' : rojo ? 'text-red-400' : 'text-gray-200'}>{plata(v)}</dd>
    </div>
  );
}
