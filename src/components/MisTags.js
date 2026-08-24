'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul',
  'ago', 'sep', 'oct', 'nov', 'dic'];

const TOPE_DETALLE = 100;   // cuántas pasadas se pintan de una; el resto con "Ver más"

// "2026-08-13" → Date local. Sin esto, new Date("2026-08-13") se interpreta en
// UTC y en Chile cae el día anterior, así que el nombre del día saldría corrido.
function aFecha(s) {
  const [a, m, d] = s.split('-');
  return new Date(+a, +m - 1, +d);
}
function iso(f) {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}
function plata(n) {
  return '$' + Math.round(n).toLocaleString('es-CL');
}
function nombreDia(s) {
  const f = aFecha(s);
  return `${DIAS_SEMANA[f.getDay()]} ${f.getDate()} de ${MESES[f.getMonth()]}`;
}
function diaLargo(s) {
  const f = aFecha(s);
  return `${f.getDate()} de ${MESES[f.getMonth()]}`;
}
function fechaCorta(s) {
  const f = aFecha(s);
  return `${f.getDate()} de ${MESES_CORTOS[f.getMonth()]}`;
}

// generatedAt viene en ISO/UTC desde el snapshot; se muestra en hora de Chile.
function fechaHoraCorta(isoUtc) {
  const f = new Date(isoUtc);
  if (isNaN(f)) return '';
  return f.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

/* La semana de cobro va de jueves a miércoles y se paga el miércoles. Pero acá
   las pasadas se agrupan por el día en que se usó el TAG, no por el día en que se
   cargó, y el sistema carga con un día de atraso. Así que el bloque que se paga
   un miércoles son los usos del miércoles anterior al martes:

     usos    mié 19 ─────────────────► mar 25
     cargas          jue 20 ─────────────────► mié 26   ← se paga este día

   Por eso las tarjetas empiezan en miércoles: cada una es exactamente lo que se
   cobra en su pago, y arriba dice de qué pago se trata.

   Es un corte propio del conductor. Gestión mira otros dos —domingo a sábado en
   la tabla de evolución y sábado a viernes en las tarjetas de cobranza— y no se
   tocan desde acá. */
function inicioSemana(s) {
  const f = aFecha(s);
  f.setDate(f.getDate() - ((f.getDay() + 4) % 7)); // 3 = miércoles
  return f;
}
// Rango de USO de la semana: del miércoles al martes siguiente
function etiquetaSemana(inicioIso) {
  const l = aFecha(inicioIso);
  const d = new Date(l.getFullYear(), l.getMonth(), l.getDate() + 6);
  return l.getMonth() === d.getMonth()
    ? `${l.getDate()} al ${d.getDate()} de ${MESES[d.getMonth()]}`
    : `${l.getDate()} ${MESES_CORTOS[l.getMonth()]} al ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}
// Miércoles en que se paga: 7 días después del miércoles en que empezó el uso
function diaDePago(inicioIso) {
  const l = aFecha(inicioIso);
  const p = new Date(l.getFullYear(), l.getMonth(), l.getDate() + 7);
  return `${p.getDate()} de ${MESES_CORTOS[p.getMonth()]}`;
}

const TARJETA = 'flex-none w-[168px] snap-start rounded-xl bg-white p-4 shadow-sm text-left';
const TIRA = 'flex gap-2.5 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pt-1 pb-3';

export default function MisTags({ inicial }) {
  const [datos, setDatos] = useState(inicial || null);
  const [error, setError] = useState('');
  const [diaActivo, setDiaActivo] = useState(null);
  const [semanaActiva, setSemanaActiva] = useState(null);
  const [visibles, setVisibles] = useState(TOPE_DETALLE);
  const avisoRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    if (inicial) return;
    let vivo = true;
    fetch('/api/conductor/peajes', { cache: 'no-store' })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!vivo) return;
        if (ok) setDatos(j);
        else setError(j.error || 'No pudimos cargar tus TAG.');
      })
      .catch(() => vivo && setError('Sin conexión. Revisa tus datos móviles.'));
    return () => { vivo = false; };
  }, [inicial]);

  // "Hoy" y "ayer" en vez de la fecha: es como el conductor piensa el día.
  const { HOY, AYER } = useMemo(() => {
    const hoy = new Date();
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    return { HOY: iso(hoy), AYER: iso(ayer) };
  }, []);

  const agregados = useMemo(() => {
    if (!datos?.transacciones) return null;
    let total = 0;
    const porDia = {}, porSemana = {};
    for (const t of datos.transacciones) {
      total += t.valor;
      if (!porDia[t.fecha]) porDia[t.fecha] = { monto: 0, n: 0 };
      porDia[t.fecha].monto += t.valor;
      porDia[t.fecha].n++;
      const sem = iso(inicioSemana(t.fecha));
      if (!porSemana[sem]) porSemana[sem] = { monto: 0, n: 0 };
      porSemana[sem].monto += t.valor;
      porSemana[sem].n++;
    }
    // Lo más reciente primero: es lo que el conductor viene a mirar.
    return {
      total,
      porDia,
      porSemana,
      dias: Object.keys(porDia).sort().reverse(),
      semanas: Object.keys(porSemana).sort().reverse(),
    };
  }, [datos]);

  /* El día manda sobre la semana: si hay un día elegido se muestra ese y nada
     más, aunque venga de una semana filtrada. */
  const lista = useMemo(() => {
    if (!datos?.transacciones) return [];
    let l = datos.transacciones;
    if (diaActivo) l = l.filter((t) => t.fecha === diaActivo);
    else if (semanaActiva) l = l.filter((t) => iso(inicioSemana(t.fecha)) === semanaActiva);
    else l = l.slice();
    return l.sort((a, b) => (b.fecha + (b.hora || '')).localeCompare(a.fecha + (a.hora || '')));
  }, [datos, diaActivo, semanaActiva]);

  function seleccionar(d) {
    setDiaActivo(d);
    setVisibles(TOPE_DETALLE);   // cambiar de día vuelve a empezar desde arriba
    if (d) setTimeout(() => avisoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  }

  // Tocar una semana filtra los días y el detalle. Si había un día elegido de
  // otra semana se suelta, porque si no la pantalla queda mostrando algo que no
  // pertenece a la semana que se acaba de tocar.
  function seleccionarSemana(s) {
    const nueva = s === semanaActiva ? null : s;
    setSemanaActiva(nueva);
    if (diaActivo && (!nueva || iso(inicioSemana(diaActivo)) !== nueva)) setDiaActivo(null);
    setVisibles(TOPE_DETALLE);
  }

  async function salir() {
    await fetch('/api/conductor/logout', { method: 'POST' });
    router.push('/conductores');
    router.refresh();
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold text-gray-800">{error}</p>
        <button onClick={salir} className="mt-6 rounded-xl bg-marca-azul px-6 py-3 font-bold text-white">
          Volver a entrar
        </button>
      </div>
    );
  }

  if (!agregados) {
    return <p className="px-4 py-16 text-center text-lg text-gray-500">Cargando tus TAG…</p>;
  }

  const { total, porDia, porSemana, dias: todosLosDias, semanas } = agregados;
  const semanaActual = todosLosDias.length ? iso(inicioSemana(HOY)) : null;
  // La tira de días sigue a la semana elegida
  const dias = semanaActiva
    ? todosLosDias.filter((d) => iso(inicioSemana(d)) === semanaActiva)
    : todosLosDias;
  const recorte = lista.slice(0, visibles);
  const suma = lista.reduce((a, t) => a + t.valor, 0);

  return (
    <div className="min-h-screen bg-gray-100 pb-16">

      {/* ── Logo ─────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
          <img src="/gocab-full.svg" alt="GoCab" className="h-[30px] w-auto" />
          <button onClick={salir} className="text-sm font-bold text-gray-500 underline">
            Salir
          </button>
        </div>
      </div>

      {/* ── Saludo ───────────────────────────────────────────── */}
      <header className="bg-marca-azul px-4 pb-7 pt-5 text-white">
        <div className="mx-auto max-w-[720px]">
          <div className="text-[26px] font-extrabold">Hola, {datos.nombre}</div>
          <span className="mt-2 inline-block rounded-lg border border-white/35 bg-white/20 px-3 py-1
            text-base font-bold tracking-widest">
            {datos.patente}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[720px] px-4">

        {/* ── Total ──────────────────────────────────────────── */}
        <div className="-mt-3.5 rounded-2xl bg-white p-6 text-center shadow-md">
          <div className="text-[17px] font-semibold text-gray-500">Total de tus TAG</div>
          <div className="my-1 text-[46px] font-extrabold leading-none tracking-tight text-marca-azul">
            {plata(total)}
          </div>
          <div className="text-[15px] text-gray-500">
            {dias.length === 0 ? 'Todavía sin pasadas'
              : dias[0] === dias[dias.length - 1] ? diaLargo(dias[0])
              : `Del ${diaLargo(dias[dias.length - 1])} al ${diaLargo(dias[0])}`}
          </div>
        </div>

        {/* ── Semanas ────────────────────────────────────────── */}
        <h2 className="mb-1 mt-8 text-xl font-extrabold">Por semana de pago</h2>
        <p className="mb-3 text-[15px] leading-snug text-gray-500">
          La semana de cobro va de <b>jueves a miércoles</b> y se paga el <b>miércoles</b>.
          Como tus pasadas se cargan al día siguiente de usarlas, ese pago corresponde a
          lo que usaste <b>del miércoles al martes</b>. <b>Toca un pago</b> para ver abajo
          solo esos días.
        </p>
        <div className={TIRA}>
          {semanas.map((s) => {
            const v = porSemana[s];
            const actual = s === semanaActual;
            const elegida = s === semanaActiva;
            return (
              <button
                key={s}
                onClick={() => seleccionarSemana(s)}
                aria-pressed={elegida}
                className={`${TARJETA} border-2 border-t-4 ${elegida
                  ? 'border-marca-oliva bg-marca-azul-tenue'
                  : 'border-transparent border-t-marca-oliva'}`}
              >
                <div className={`text-[15px] font-bold leading-tight ${actual ? 'text-marca-azul' : ''}`}>
                  {actual ? 'Pago en curso' : 'Pago'}
                </div>
                <div className="mt-0.5 text-[13px] font-semibold text-gray-600">
                  miércoles {diaDePago(s)}
                </div>
                <div className="mt-2.5 text-[22px] font-extrabold">{plata(v.monto)}</div>
                <div className="text-[13px] text-gray-500">{v.n === 1 ? '1 pasada' : `${v.n} pasadas`}</div>
                <div className="mt-1.5 text-[12px] leading-snug text-gray-500">
                  usos del {etiquetaSemana(s)}
                </div>
                {actual && (
                  <div className="mt-1 text-[12px] font-semibold leading-snug text-marca-azul">
                    todavía sumando
                  </div>
                )}
                <div className="mt-2 text-[13px] font-bold text-marca-azul">
                  Ver estos días{elegida ? ' ✓' : ''}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Días ───────────────────────────────────────────── */}
        <h2 className="mb-1 mt-8 text-xl font-extrabold">Por día</h2>
        <p className="mb-3 text-[15px] leading-snug text-gray-500">
          {semanaActiva
            ? <>Días del pago del miércoles {diaDePago(semanaActiva)}. <b>Toca un día</b> para
               ver abajo solo las pasadas de ese día.</>
            : <>Desliza hacia el lado para ver más días. <b>Toca un día</b> para ver abajo
               solo las pasadas de ese día.</>}
        </p>
        <div className={TIRA}>
          {dias.map((d) => {
            const v = porDia[d];
            const activo = d === diaActivo;
            const especial = d === HOY || d === AYER;
            return (
              <button
                key={d}
                onClick={() => seleccionar(activo ? null : d)}
                className={`${TARJETA} border-2 border-t-4 ${activo
                  ? 'border-marca-azul bg-marca-azul-tenue'
                  : 'border-transparent border-t-marca-azul-borde'}`}
              >
                <div className={`text-[15px] font-bold leading-tight first-letter:uppercase
                  ${especial ? 'text-marca-azul' : ''}`}>
                  {d === HOY ? 'Hoy' : d === AYER ? 'Ayer' : DIAS_SEMANA[aFecha(d).getDay()]}
                </div>
                <div className="mt-0.5 text-[13px] text-gray-500">{fechaCorta(d)}</div>
                <div className="mt-2.5 text-[22px] font-extrabold">{plata(v.monto)}</div>
                <div className="text-[13px] text-gray-500">{v.n === 1 ? '1 pasada' : `${v.n} pasadas`}</div>
                <div className="mt-2 text-[13px] font-bold text-marca-azul">
                  Ver detalle{activo ? ' ✓' : ''}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Detalle ────────────────────────────────────────── */}
        <h2 className="mb-1 mt-8 text-xl font-extrabold">Detalle de cada pasada</h2>
        <p className="mb-3 text-[15px] leading-snug text-gray-500">
          {diaActivo || semanaActiva
            ? `Estas son las ${lista.length} ${lista.length === 1 ? 'pasada' : 'pasadas'} de lo que elegiste.`
            : `Cada línea es una vez que pasaste por un pórtico. Son ${lista.length} en total.`}
        </p>

        <div ref={avisoRef}>
          {(diaActivo || semanaActiva) && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl
              border-2 border-marca-azul bg-marca-azul-tenue p-4">
              <span className="text-base font-bold first-letter:uppercase">
                {diaActivo
                  ? `Mostrando solo el ${nombreDia(diaActivo)}`
                  : `Mostrando el pago del miércoles ${diaDePago(semanaActiva)}`}
              </span>
              <button
                onClick={() => { seleccionar(null); setSemanaActiva(null); }}
                className="min-h-[44px] rounded-full bg-marca-azul px-5 py-2.5 text-[15px]
                  font-bold text-white hover:bg-marca-azul-oscuro"
              >
                Ver todo
              </button>
            </div>
          )}
        </div>

        {recorte.map((t, i) => (
          <div key={i} className="mb-2 flex flex-col justify-between gap-1.5 rounded-xl bg-white
            p-4 shadow-sm sm:flex-row sm:gap-3.5">
            <div>
              <div className="mb-0.5 text-[15px] font-semibold text-gray-500">
                {fechaCorta(t.fecha)} · {t.hora}
              </div>
              <div className="text-base font-bold leading-tight">{t.autopista}</div>
              <div className="mt-0.5 text-sm leading-snug text-gray-500">{t.portico}</div>
            </div>
            <div className="self-end whitespace-nowrap text-lg font-extrabold sm:self-auto">
              {plata(t.valor)}
            </div>
          </div>
        ))}

        {lista.length > recorte.length && (
          <button
            onClick={() => setVisibles((v) => v + TOPE_DETALLE)}
            className="mt-1 min-h-[52px] w-full rounded-xl border-2 border-marca-azul bg-white
              p-4 text-base font-bold text-marca-azul hover:bg-marca-azul-tenue"
          >
            Ver {Math.min(TOPE_DETALLE, lista.length - recorte.length)} pasadas más
          </button>
        )}

        {/* El total suma la lista completa, no solo lo que está pintado. */}
        <div className="mt-3.5 flex items-center justify-between gap-3 rounded-xl bg-marca-azul
          p-4 text-lg font-extrabold text-white">
          <span>{diaActivo ? `Total del ${diaLargo(diaActivo)}` : 'Total de todo'}</span>
          <span>{plata(suma)}</span>
        </div>

        {/* ── Explicaciones ──────────────────────────────────── */}
        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-base font-bold">¿Cada cuánto se actualiza?</h3>
          <p className="mt-1 text-[15px] leading-relaxed text-gray-600">
            Todos los días por la mañana. Las autopistas informan las pasadas con algo
            de atraso, así que los últimos días pueden todavía no estar completos: lo
            del miércoles suele aparecer recién el jueves.
          </p>

          <h3 className="mt-5 text-base font-bold">¿Ves una pasada que no reconoces?</h3>
          <p className="mt-1 text-[15px] leading-relaxed text-gray-600">
            Avísale a tu coordinador de flota. Las pasadas las registran las autopistas
            con el TAG del auto, y lo que ves acá es exactamente lo que ellas informan.
            Si hay que reclamar una, se hace con la factura que las autopistas emiten a
            fin de mes: ese documento es el respaldo para presentar el reclamo.
          </p>
        </div>

        <p className="mt-6 text-center text-sm leading-relaxed text-gray-500">
          Los datos vienen directamente de tu TAG.
          {datos.actualizado && (
            <><br />Última actualización: {fechaHoraCorta(datos.actualizado)}</>
          )}
        </p>
      </div>
    </div>
  );
}
