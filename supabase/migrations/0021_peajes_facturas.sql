-- Cruce de peajes contra las facturas de las autopistas.
--
-- El cruce lo sigue calculando el proceso semanal en Python (Conciliacion
-- Peajes/_sistema/src/semanal.py): lee las facturas de las 7 concesionarias. Su
-- resultado ("Cruce Peajes por Conductor - Semana <fecha>.xlsx") y el libro de
-- ajustes se suben en GoBills, en la pestaña de peajes.
--
-- Desde nov-2026 si un ajuste se aplicó o no se marca en GoBills, y el proceso
-- semanal lo lee de acá antes de calcular: es lo que evita cobrar o devolver dos
-- veces lo mismo.

-- Una corrida del proceso semanal. Volver a subir la de la misma fecha la reemplaza.
create table if not exists public.peajes_corridas (
  fecha date primary key,
  archivo text not null,
  resumen text,
  facturas_hasta date,                  -- último día que cubre alguna factura
  usuario_email citext not null,
  creado timestamptz not null default now()
);
alter table public.peajes_corridas enable row level security;

-- Hojas "Conductores" y "Ya no estan" de esa corrida: qué se cruzó de cada uno
create table if not exists public.peajes_cruce (
  corrida date not null references public.peajes_corridas (fecha) on delete cascade,
  nombre text not null,
  rut text,
  patentes text,
  desde date,
  hasta date,
  dias int,
  facturado int not null default 0,
  cobrado int not null default 0,
  pagado int not null default 0,
  accion text,
  cobrar int not null default 0,
  rebajar int not null default 0,
  devolver int not null default 0,
  estado text,                          -- Cruzado | Pendiente de factura
  autopistas_comparadas text,
  cobrado_sin_factura int not null default 0,
  autopistas_sin_factura text,
  motivo text,
  activo boolean not null default true
);
create index if not exists peajes_cruce_corrida on public.peajes_cruce (corrida);
alter table public.peajes_cruce enable row level security;

-- Hojas "Facturas incluidas" y "Facturas NO incluidas"
create table if not exists public.peajes_facturas (
  corrida date not null references public.peajes_corridas (fecha) on delete cascade,
  emisor text not null,
  cuenta text,
  folio text,
  desde date,
  hasta date,
  pasadas int,
  monto int,
  grupo text,                           -- autos que cubre: VS/VV, VY, VZ…
  incluida boolean not null,
  motivo text                           -- por qué no se incluyó
);
create index if not exists peajes_facturas_corrida on public.peajes_facturas (corrida);
alter table public.peajes_facturas enable row level security;

-- Libro de ajustes. id es el del libro. Lo que se marca en GoBills (marcado_en)
-- no lo pisa una subida del Excel.
create table if not exists public.peajes_ajustes (
  id int primary key,
  fecha_corrida date,
  conductor text not null,
  rut text,
  patentes text,
  desde date,
  hasta date,
  dias int,
  accion text,
  monto_propuesto int,                  -- positivo = cobro, negativo = rebaja o devolución
  rebajar_deuda int,
  devolver_plata int,
  estado text not null,                 -- PROPUESTO | APLICADO | NO APLICADO | REEMPLAZADO (…) | ANULADO (…)
  monto_aplicado int,
  fecha_aplicado date,
  referencia text,
  nota text,
  marcado_por citext,
  marcado_en timestamptz
);
create index if not exists peajes_ajustes_estado on public.peajes_ajustes (estado);
alter table public.peajes_ajustes enable row level security;

grant select, insert, update, delete on public.peajes_corridas, public.peajes_cruce, public.peajes_facturas, public.peajes_ajustes to service_role;
revoke all on public.peajes_corridas, public.peajes_cruce, public.peajes_facturas, public.peajes_ajustes from anon, authenticated;

/**
 * Sube una corrida y el libro de ajustes, todo o nada.
 * p_corrida: { fecha, archivo, resumen, facturasHasta }
 * p_cruce, p_facturas: filas de esas hojas · p_ajustes: el libro entero
 */
create or replace function public.subir_corrida_peajes(p_corrida jsonb, p_cruce jsonb, p_facturas jsonb, p_ajustes jsonb, p_usuario text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_fecha date := (p_corrida->>'fecha')::date;
  v_nuevos int;
  v_total int;
begin
  delete from peajes_corridas where fecha = v_fecha;
  insert into peajes_corridas (fecha, archivo, resumen, facturas_hasta, usuario_email)
  values (v_fecha, p_corrida->>'archivo', p_corrida->>'resumen', (p_corrida->>'facturasHasta')::date, p_usuario);

  insert into peajes_cruce
  select v_fecha, x.nombre, x.rut, x.patentes, x.desde, x.hasta, x.dias, coalesce(x.facturado, 0), coalesce(x.cobrado, 0),
         coalesce(x.pagado, 0), x.accion, coalesce(x.cobrar, 0), coalesce(x.rebajar, 0), coalesce(x.devolver, 0), x.estado,
         x.autopistas_comparadas, coalesce(x.cobrado_sin_factura, 0), x.autopistas_sin_factura, x.motivo, coalesce(x.activo, true)
  from jsonb_to_recordset(p_cruce) as x (nombre text, rut text, patentes text, desde date, hasta date, dias int, facturado int,
       cobrado int, pagado int, accion text, cobrar int, rebajar int, devolver int, estado text, autopistas_comparadas text,
       cobrado_sin_factura int, autopistas_sin_factura text, motivo text, activo boolean);

  insert into peajes_facturas
  select v_fecha, x.emisor, x.cuenta, x.folio, x.desde, x.hasta, x.pasadas, x.monto, x.grupo, x.incluida, x.motivo
  from jsonb_to_recordset(p_facturas) as x (emisor text, cuenta text, folio text, desde date, hasta date, pasadas int,
       monto int, grupo text, incluida boolean, motivo text);

  select count(*) into v_total from peajes_ajustes;
  insert into peajes_ajustes (id, fecha_corrida, conductor, rut, patentes, desde, hasta, dias, accion, monto_propuesto,
                              rebajar_deuda, devolver_plata, estado, monto_aplicado, fecha_aplicado, referencia, nota)
  select x.id, x.fecha_corrida, x.conductor, x.rut, x.patentes, x.desde, x.hasta, x.dias, x.accion, x.monto_propuesto,
         x.rebajar_deuda, x.devolver_plata, x.estado, x.monto_aplicado, x.fecha_aplicado, x.referencia, x.nota
  from jsonb_to_recordset(p_ajustes) as x (id int, fecha_corrida date, conductor text, rut text, patentes text, desde date,
       hasta date, dias int, accion text, monto_propuesto int, rebajar_deuda int, devolver_plata int, estado text,
       monto_aplicado int, fecha_aplicado date, referencia text, nota text)
  on conflict (id) do update set
    fecha_corrida = excluded.fecha_corrida, conductor = excluded.conductor, rut = excluded.rut,
    patentes = excluded.patentes, desde = excluded.desde, hasta = excluded.hasta, dias = excluded.dias,
    accion = excluded.accion, monto_propuesto = excluded.monto_propuesto, rebajar_deuda = excluded.rebajar_deuda,
    devolver_plata = excluded.devolver_plata, nota = excluded.nota,
    -- Lo marcado en GoBills manda; solo un "no se aplicó" pasa a REEMPLAZADO cuando el proceso lo recalcula
    estado = case
      when peajes_ajustes.marcado_en is null then excluded.estado
      when peajes_ajustes.estado = 'NO APLICADO' and excluded.estado like 'REEMPLAZADO%' then excluded.estado
      else peajes_ajustes.estado end,
    monto_aplicado = case when peajes_ajustes.marcado_en is null then excluded.monto_aplicado else peajes_ajustes.monto_aplicado end,
    fecha_aplicado = case when peajes_ajustes.marcado_en is null then excluded.fecha_aplicado else peajes_ajustes.fecha_aplicado end,
    referencia = case when peajes_ajustes.marcado_en is null then excluded.referencia else peajes_ajustes.referencia end;
  select count(*) - v_total into v_nuevos from peajes_ajustes;

  return jsonb_build_object('conductores', jsonb_array_length(p_cruce), 'facturas', jsonb_array_length(p_facturas),
                            'ajustes', jsonb_array_length(p_ajustes), 'ajustesNuevos', v_nuevos);
end;
$$;

revoke all on function public.subir_corrida_peajes(jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.subir_corrida_peajes(jsonb, jsonb, jsonb, jsonb, text) to service_role;
