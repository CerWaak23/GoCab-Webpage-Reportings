'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n/useLang';

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const plata = (n) => CLP.format(Math.round(n || 0));
const fechaCorta = (iso) => (iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const CONCEPTOS = ['tags', 'multas', 'renta', 'danos', 'otro'];

async function pedir(url, cuerpo) {
  const r = await fetch(url, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : { cache: 'no-store' });
  return r.json().catch(() => ({ error: 'red' }));
}

/** Liquidación de los conductores despedidos: lo que deben, lo que cubre la garantía y el anexo de DICOM. */
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
      if (filtro === 'deben') return f.liquidacion.nosDebe > 0;
      if (filtro === 'devolver') return f.liquidacion.devolver > 0;
      if (filtro === 'sin_anexo') return !f.gestion.anexoDicom;
      return true;
    });
  }, [datos, filtro, buscar]);

  if (!datos) return <p className="text-sm text-gray-400">{t('dp_cargando')}</p>;
  if (datos.error === 'sin_migracion') return <p className="text-sm text-amber-400">{t('dp_sin_migracion')}</p>;
  if (datos.error) return <p className="text-sm text-red-400">{t('dp_error_guardar')}</p>;
  if (datos.filas.length === 0) {
    return (
      <div className="text-sm text-gray-400 space-y-3">
        <p>{t('dp_vacio')}</p>
        <a href="/carga" className="inline-block rounded-lg bg-sky-500 text-gray-950 font-semibold px-4 py-2">{t('dp_ir_carga')}</a>
      </div>
    );
  }

  const todas = datos.filas;
  const deben = todas.filter((f) => f.liquidacion.nosDebe > 0);
  const devolver = todas.filter((f) => f.liquidacion.devolver > 0);
  const anexos = todas.filter((f) => f.gestion.anexoDicom).length;

  return (
    <div className="space-y-5">
      <p className="text-gray-500 text-xs">
        {t('dp_sub')}
        {datos.ultimaCarga && <> · {t('dp_ultima_carga')}: {fechaCorta(datos.ultimaCarga.creado)} ({datos.ultimaCarga.archivo})</>}
      </p>
      {datos.avisos?.map((a) => <p key={a} className="text-xs text-amber-400">{t('dp_aviso_fuente')(a)}</p>)}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tarjeta titulo={t('dp_nos_deben')} valor={plata(deben.reduce((s, f) => s + f.liquidacion.nosDebe, 0))} pie={t('dp_personas')(deben.length)} color="text-red-400" />
        <Tarjeta titulo={t('dp_devolver')} valor={plata(devolver.reduce((s, f) => s + f.liquidacion.devolver, 0))} pie={t('dp_personas')(devolver.length)} color="text-emerald-400" />
        <Tarjeta titulo={t('dp_anexos')} valor={`${anexos} / ${todas.length}`} pie="" color="text-sky-300" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {['todos', 'deben', 'devolver', 'sin_anexo'].map((f) => (
          <button key={f} type="button" onClick={() => setFiltro(f)}
            className={`rounded-full border px-3 py-1 text-xs ${filtro === f ? 'border-sky-400 bg-sky-500/15 text-sky-200' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
            {t(`dp_f_${f}`)}
          </button>
        ))}
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder={t('dp_buscar')}
          className="ml-auto w-full sm:w-56 rounded-lg bg-gray-900 border border-gray-700 px-3 py-1.5 text-sm outline-none focus:border-sky-500" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">{t('dp_col_nombre')}</th>
              <th className="text-right px-3 py-2">{t('dp_col_renta')}</th>
              <th className="text-right px-3 py-2">{t('dp_col_tags')}</th>
              <th className="text-right px-3 py-2">{t('dp_col_multas')}</th>
              <th className="text-right px-3 py-2">{t('dp_col_otros')}</th>
              <th className="text-right px-3 py-2">{t('dp_col_ajustes')}</th>
              <th className="text-right px-3 py-2">{t('dp_col_garantia')}</th>
              <th className="text-right px-3 py-2">{t('dp_col_saldo')}</th>
              <th className="text-center px-3 py-2">{t('dp_col_anexo')}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <Fragment key={f.clave}>
                <Fila f={f} t={t} abierto={abierto === f.clave} onAbrir={() => setAbierto(abierto === f.clave ? null : f.clave)} onCambio={cargar} />
                {abierto === f.clave && (
                  <tr className="bg-gray-900/70"><td colSpan={9} className="px-4 py-4"><Detalle f={f} t={t} onCambio={cargar} /></td></tr>
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

const montoCelda = (n) => (n > 0 ? plata(n) : <span className="text-gray-600">—</span>);

function Resultado({ l, t }) {
  if (l.nosDebe > 0) return <span className="font-semibold text-red-400">{t('dp_saldo_debe')} {plata(l.nosDebe)}</span>;
  if (l.devolver > 0) return <span className="font-semibold text-emerald-400">{t('dp_saldo_devolver')} {plata(l.devolver)}</span>;
  if (l.devuelto > 0) return <span className="text-gray-400">✓ {t('dp_devuelta')}</span>;
  return <span className="text-gray-400">✓ {t('dp_saldo_cero')}</span>;
}

function Fila({ f, t, abierto, onAbrir, onCambio }) {
  const l = f.liquidacion;
  const [guardando, setGuardando] = useState(false);
  async function anexo(valor) {
    setGuardando(true);
    const r = await pedir('/api/despedidos/gestion', { clave: f.clave, accion: 'anexo', valor });
    setGuardando(false);
    if (r.error) alert(t('dp_error_guardar')); else onCambio();
  }
  return (
    <tr className={`border-t border-gray-800 hover:bg-gray-900/50 ${abierto ? 'bg-gray-900/70' : ''}`}>
      <td className="px-3 py-2 cursor-pointer" onClick={onAbrir}>
        <p className="font-medium">{f.nombre}</p>
        <p className="text-[11px] text-gray-500">{t('dp_despedido')} {fechaCorta(f.despido)}</p>
      </td>
      <td className="px-3 py-2 text-right">
        {l.rentaAdeudada > 0 ? plata(l.rentaAdeudada)
          : l.rentaAFavor > 0 ? <span className="text-emerald-400">{plata(l.rentaAFavor)} <span className="text-[10px]">{t('dp_a_favor')}</span></span>
          : <span className="text-gray-600">—</span>}
      </td>
      <td className="px-3 py-2 text-right">{montoCelda(l.tags)}</td>
      <td className="px-3 py-2 text-right">{montoCelda(l.multas)}</td>
      <td className="px-3 py-2 text-right">{montoCelda(l.otros)}</td>
      <td className="px-3 py-2 text-right">{l.ajustes ? plata(l.ajustes) : <span className="text-gray-600">—</span>}</td>
      <td className="px-3 py-2 text-right">{montoCelda(f.garantia)}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap cursor-pointer" onClick={onAbrir}><Resultado l={l} t={t} /></td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={f.gestion.anexoDicom} disabled={guardando} onChange={(e) => anexo(e.target.checked)}
          title={f.gestion.anexoDicom && f.gestion.anexoPor ? t('dp_anexo_por')(f.gestion.anexoPor, fechaCorta(f.gestion.anexoFecha)) : ''}
          className="w-4 h-4 accent-sky-500 cursor-pointer" />
      </td>
    </tr>
  );
}

function Detalle({ f, t, onCambio }) {
  const l = f.liquidacion;
  const g = f.gestion;
  const [ajuste, setAjuste] = useState({ monto: '', concepto: 'multas', nota: '' });
  const [devuelto, setDevuelto] = useState({ monto: g.devuelto || '', fecha: g.devueltoFecha || '' });
  const [nota, setNota] = useState(g.nota || '');
  const [ocupado, setOcupado] = useState(false);

  async function enviar(cuerpo, despues) {
    setOcupado(true);
    const r = await pedir('/api/despedidos/gestion', { clave: f.clave, ...cuerpo });
    setOcupado(false);
    if (r.error) { alert(t('dp_error_guardar')); return; }
    despues?.();
    onCambio();
  }
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
          {f.garantia - l.conGarantia > 0 && <Linea k={t('dp_det_sobra')} v={f.garantia - l.conGarantia} />}
          {l.devuelto > 0 && <Linea k={`${t('dp_det_ya_devuelto')}${g.devueltoFecha ? ' · ' + fechaCorta(g.devueltoFecha) : ''}`} v={-l.devuelto} />}
          {l.devolver > 0 && <Linea k={t('dp_saldo_devolver')} v={l.devolver} fuerte verde />}
        </dl>
        {f.comentario && (
          <p className="mt-3 text-xs text-gray-500 whitespace-pre-line"><span className="text-gray-400">{t('dp_comentario_fleet')}:</span> {f.comentario}</p>
        )}
      </div>

      <div className="space-y-5">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500">{t('dp_ajustes_titulo')}</p>
          <p className="text-xs text-gray-500 mb-2">{t('dp_ajustes_ayuda')}</p>
          {g.ajustes.length > 0 && (
            <ul className="text-sm mb-2 divide-y divide-gray-800">
              {g.ajustes.map((a) => (
                <li key={a.id} className="py-1 flex items-center gap-2">
                  <span className={a.monto < 0 ? 'text-emerald-400' : 'text-gray-200'}>{plata(a.monto)}</span>
                  <span className="text-gray-400">{t(`dp_concepto_${a.concepto}`)}</span>
                  {a.nota && <span className="text-gray-500 truncate">· {a.nota}</span>}
                  <span className="ml-auto text-[10px] text-gray-600">{a.por} · {fechaCorta(a.fecha)}</span>
                  <button type="button" disabled={ocupado} onClick={() => enviar({ accion: 'quitarAjuste', id: a.id })}
                    className="text-gray-500 hover:text-red-400 text-xs px-1" aria-label="Quitar">✕</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <input type="number" placeholder={t('dp_ajuste_monto')} value={ajuste.monto} onChange={(e) => setAjuste({ ...ajuste, monto: e.target.value })} className={`${campo} w-28`} />
            <select value={ajuste.concepto} onChange={(e) => setAjuste({ ...ajuste, concepto: e.target.value })} className={campo}>
              {CONCEPTOS.map((c) => <option key={c} value={c}>{t(`dp_concepto_${c}`)}</option>)}
            </select>
            <input placeholder={t('dp_ajuste_nota')} value={ajuste.nota} onChange={(e) => setAjuste({ ...ajuste, nota: e.target.value })} className={`${campo} flex-1 min-w-[8rem]`} />
            <button type="button" className={boton} disabled={ocupado || !Number(ajuste.monto)}
              onClick={() => enviar({ accion: 'ajuste', ...ajuste, monto: Number(ajuste.monto) }, () => setAjuste({ monto: '', concepto: 'multas', nota: '' }))}>
              {t('dp_ajuste_agregar')}
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500">{t('dp_devuelto_titulo')}</p>
          <p className="text-xs text-gray-500 mb-2">{t('dp_devuelto_ayuda')}</p>
          <div className="flex flex-wrap gap-2">
            <input type="number" min="0" placeholder={t('dp_ajuste_monto')} value={devuelto.monto} onChange={(e) => setDevuelto({ ...devuelto, monto: e.target.value })} className={`${campo} w-28`} />
            <input type="date" value={devuelto.fecha} onChange={(e) => setDevuelto({ ...devuelto, fecha: e.target.value })} className={campo} aria-label={t('dp_fecha')} />
            <button type="button" className={boton} disabled={ocupado}
              onClick={() => enviar({ accion: 'devuelto', monto: Number(devuelto.monto) || 0, fecha: devuelto.fecha })}>
              {t('dp_guardar')}
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{t('dp_nota_titulo')}</p>
          <div className="flex gap-2">
            <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} className={`${campo} flex-1`} />
            <button type="button" className={`${boton} self-start`} disabled={ocupado || nota === (g.nota || '')}
              onClick={() => enviar({ accion: 'nota', texto: nota })}>{t('dp_guardar')}</button>
          </div>
          {g.actualizadoPor && <p className="text-[10px] text-gray-600 mt-1">{g.actualizadoPor} · {fechaCorta(g.actualizado)}</p>}
        </div>
      </div>
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
