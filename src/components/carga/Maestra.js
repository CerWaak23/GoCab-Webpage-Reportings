'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n/useLang';
import { TIPOS } from '@/lib/maestra/maestra';

async function pedir(url, cuerpo) {
  const r = await fetch(url, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : undefined);
  return r.json().catch(() => ({ error: 'red' }));
}

function haceCuanto(iso, t) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return t('carga_hace_min')(min);
  if (min < 48 * 60) return t('carga_hace_h')(Math.round(min / 60));
  return t('carga_hace_d')(Math.round(min / 1440));
}

const COLUMNAS = ['nombre', 'patente', 'rut', 'creado', 'encargado', 'tipo', 'estadoFleet'];
const ETIQUETA = { nombre: 'ma_col_conductor', patente: 'ma_col_patente', rut: 'ma_col_rut', creado: 'ma_col_desde', encargado: 'ma_col_encargado', tipo: 'ma_col_tipo', estadoFleet: 'ma_col_estado' };
const EDITABLES = ['nombre', 'rut', 'encargado', 'tipo'];
const ERRORES = ['rut', 'tipo', 'largo', 'base', 'hoja', 'hoja_permiso'];

/**
 * Maestra de Control Flota: una fila por auto, armada con los exports de
 * Fleet y corregible a mano. Cada corrección se copia a la hoja de Google.
 */
export default function Maestra() {
  const { t } = useLang();
  const [datos, setDatos] = useState(null);
  const [buscar, setBuscar] = useState('');
  const [encargado, setEncargado] = useState('');
  const [soloCorregidos, setSoloCorregidos] = useState(false);
  const [soloDistintos, setSoloDistintos] = useState(false);
  const [editando, setEditando] = useState(null); // { patente, campo, valor }
  const [error, setError] = useState(null);
  const [copiando, setCopiando] = useState(false);

  const cargar = useCallback(() => pedir('/api/maestra?comparar=1').then(setDatos), []);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = datos?.filas || [];
  // null cuando la maestra ya escribe en la pestaña original: no hay con qué comparar.
  const difs = datos?.diferencias && !datos.diferencias.error ? datos.diferencias : null;
  const encargados = useMemo(() => [...new Set(filas.map((f) => f.encargado.valor).filter(Boolean))].sort(), [filas]);
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return filas.filter((f) => {
      if (encargado && f.encargado.valor !== encargado) return false;
      if (soloCorregidos && !EDITABLES.some((c) => f[c].editado)) return false;
      if (soloDistintos && !difs?.[f.patente]) return false;
      if (!q) return true;
      return [f.nombre.valor, f.patente, f.rut.valor].some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [filas, buscar, encargado, soloCorregidos, soloDistintos, difs]);

  async function guardar(valor) {
    const f = filas.find((x) => x.patente === editando.patente);
    const destino = ['encargado', 'tipo'].includes(editando.campo)
      ? { patente: f.patente }
      : { conductorId: editando.campo === 'rut' ? f.conductorRutId : f.conductorId };
    const r = await pedir('/api/maestra', { campo: editando.campo, valor, ...destino });
    if (r.error) { setError(t(ERRORES.includes(r.error) ? `ma_error_${r.error}` : 'ma_error_base')); return; }
    setEditando(null);
    setError(null);
    await cargar();
  }

  async function copiar() {
    setCopiando(true);
    const r = await pedir('/api/maestra/hoja', {});
    setCopiando(false);
    setError(r.error ? t(ERRORES.includes(r.error) ? `ma_error_${r.error}` : 'ma_error_hoja') : null);
    cargar();
  }

  if (!datos) return <p className="text-sm text-gray-500">…</p>;
  if (datos.error) return <p className="text-sm text-red-400">{t('ma_error_base')}</p>;
  if (filas.length === 0) return <p className="text-sm text-gray-500">{t('ma_vacia')}</p>;

  const corregidos = filas.reduce((n, f) => n + EDITABLES.filter((c) => f[c].editado).length, 0);
  const pestana = datos.hoja?.pestana;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-3 gap-3">
        {[['ma_autos', filas.length], ['ma_conductores', filas.filter((f) => f.conductorId).length], ['ma_corregidos', corregidos]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
            <p className="text-[11px] text-gray-500">{t(k)}</p>
            <p className="text-lg font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <p className="text-gray-400">
          {datos.sincronizada ? t('ma_hoja')(datos.sincronizada.pestana, haceCuanto(datos.sincronizada.fecha, t)) : t('ma_hoja_nunca')(pestana)}
        </p>
        {datos.puedeEditar && (
          <button type="button" onClick={copiar} disabled={copiando}
            className="rounded-lg border border-sky-500/50 px-3 py-1.5 text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">
            {copiando ? t('ma_copiando') : t('ma_copiar_hoja')}
          </button>
        )}
      </section>

      <p className="text-xs text-gray-500">{datos.puedeEditar ? t('ma_ayuda') : t('ma_solo_gerencia')}</p>
      {error && <p className="text-xs text-red-400">{error}</p>}

      <section className="flex flex-wrap gap-2">
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder={t('ma_buscar')}
          className="flex-1 min-w-[12rem] rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm" />
        <select value={encargado} onChange={(e) => setEncargado(e.target.value)}
          className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
          <option value="">{t('ma_todos_encargados')}</option>
          {encargados.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={soloCorregidos} onChange={(e) => setSoloCorregidos(e.target.checked)} />
          {t('ma_solo_corregidos')}
        </label>
        {difs && (
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={soloDistintos} onChange={(e) => setSoloDistintos(e.target.checked)} />
            {t('ma_solo_distintos')(Object.keys(difs).length)}
          </label>
        )}
        {datos.diferencias?.error && <p className="w-full text-xs text-amber-400">{t('ma_error_comparar')}</p>}
      </section>

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500">
            <tr>{COLUMNAS.map((c) => <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{t(ETIQUETA[c])}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {visibles.map((f) => (
              <tr key={f.patente} className="hover:bg-gray-900/60">
                {COLUMNAS.map((c) => (
                  <td key={c} className="px-3 py-1.5 whitespace-nowrap align-top">
                    <Celda f={f} campo={c} t={t} dif={difs?.[f.patente]} puedeEditar={datos.puedeEditar} encargados={encargados}
                      editando={editando?.patente === f.patente && editando.campo === c}
                      onEditar={() => { setError(null); setEditando({ patente: f.patente, campo: c }); }}
                      onCancelar={() => setEditando(null)} onGuardar={guardar} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Celda({ f, campo, t, dif, puedeEditar, encargados, editando, onEditar, onCancelar, onGuardar }) {
  if (campo === 'patente') {
    return (
      <>
        <span className="font-mono text-gray-200">{f.patente}</span>
        {dif?.falta && <p className="text-[10px] text-violet-300">{t('ma_no_en_hoja')}</p>}
      </>
    );
  }
  if (campo === 'creado') return <span className="text-gray-400">{f.creado || '—'}</span>;
  if (campo === 'estadoFleet') return <span className="text-gray-500">{f.estadoFleet || '—'}</span>;

  const dato = f[campo];
  // Sin conductor no hay a quién corregirle el nombre; el RUT necesita un conductor (vigente o el último).
  const editable = puedeEditar && dato.valor !== 'TOTAL LOSS'
    && (campo !== 'nombre' || f.conductorId) && (campo !== 'rut' || f.conductorRutId);

  const enHoja = dif && campo in dif ? dif[campo] : undefined;
  if (editando) return <Editor campo={campo} dato={dato} t={t} enHoja={enHoja} encargados={encargados} onCancelar={onCancelar} onGuardar={onGuardar} />;

  const texto = dato.valor ?? (campo === 'nombre' ? <span className="text-gray-600">{t('ma_sin_conductor')}</span> : <span className="text-gray-600">—</span>);
  const titulo = dato.editado ? `${t('ma_editado')(dato.autor)} · ${t('ma_fleet_dice')(dato.fleet)}` : undefined;
  return (
    <button type="button" disabled={!editable} onClick={onEditar} title={titulo}
      className={`text-left ${editable ? 'hover:text-sky-300 cursor-pointer' : 'cursor-default'} ${dato.editado ? 'text-amber-200' : 'text-gray-200'}`}>
      {texto}{dato.editado && <span className="ml-1 text-amber-400" aria-label={titulo}>●</span>}
      {enHoja !== undefined && <span className="block text-[10px] text-violet-300">{t('ma_en_hoja')(enHoja)}</span>}
    </button>
  );
}

function Editor({ campo, dato, t, enHoja, encargados, onCancelar, onGuardar }) {
  const [valor, setValor] = useState(dato.valor ?? '');
  const [guardando, setGuardando] = useState(false);
  const enviar = async (v) => { setGuardando(true); await onGuardar(v); setGuardando(false); };
  const tecla = (e) => { if (e.key === 'Enter') enviar(valor); if (e.key === 'Escape') onCancelar(); };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {campo === 'tipo' ? (
        <select autoFocus value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={tecla}
          className="rounded border border-sky-500/60 bg-gray-950 px-2 py-1">
          {TIPOS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      ) : (
        <>
          <input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={tecla}
            list={campo === 'encargado' ? 'maestra-encargados' : undefined}
            className="w-44 rounded border border-sky-500/60 bg-gray-950 px-2 py-1" />
          {campo === 'encargado' && <datalist id="maestra-encargados">{encargados.map((e) => <option key={e} value={e} />)}</datalist>}
        </>
      )}
      <button type="button" disabled={guardando} onClick={() => enviar(valor)} className="rounded bg-sky-500 px-2 py-1 font-semibold text-gray-950 disabled:opacity-50">{t('ma_guardar')}</button>
      <button type="button" onClick={onCancelar} className="px-1 text-gray-400 hover:text-white">{t('ma_cancelar')}</button>
      {enHoja && (
        <button type="button" disabled={guardando} onClick={() => enviar(enHoja)} className="px-1 text-violet-300 hover:text-violet-200">
          {t('ma_usar_hoja')}
        </button>
      )}
      {dato.editado && (
        <button type="button" disabled={guardando} onClick={() => enviar('')} className="px-1 text-amber-300 hover:text-amber-200" title={t('ma_fleet_dice')(dato.fleet)}>
          {t('ma_volver_fleet')}
        </button>
      )}
    </div>
  );
}
