-- Posición de cada fila en su export.
--
-- Los reportes recorren las filas en el orden del archivo, y ese orden decide
-- en qué orden salen las bills, las multas y los pagos. Se guarda la posición
-- (orden) para reconstruirlo igual. Las dos historias se vacían para volver a
-- importarlas desde Drive (scripts/importar-bills-drive.mjs y
-- scripts/importar-multas-drive.mjs); TRUNCATE no pasa por el trigger que
-- impide borrar versiones una a una. Drive no se toca.

alter table public.bills_versiones add column if not exists orden int;
alter table public.multas_versiones add column if not exists orden int;

truncate public.bills_versiones, public.bills_archivos restart identity;
truncate public.multas_versiones, public.multas_archivos restart identity;

create or replace function public.registrar_bills_version(p_archivo jsonb, p_filas jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
  v_subido timestamptz := (p_archivo->>'subido')::timestamptz;
  v_nuevas int;
  v_cambios int;
begin
  perform pg_advisory_xact_lock(hashtext('registrar_bills_version'));

  if exists (select 1 from bills_archivos
             where drive_id = p_archivo->>'driveId' or carga_id = (p_archivo->>'cargaId')::uuid) then
    return jsonb_build_object('ya_registrado', true);
  end if;

  insert into bills_archivos (archivo, drive_id, carga_id, subido, dia, filas, filas_sin_conductor, origen, referencias)
  values (p_archivo->>'archivo', p_archivo->>'driveId', (p_archivo->>'cargaId')::uuid, v_subido,
          (v_subido at time zone 'America/Santiago')::date,
          jsonb_array_length(p_filas),
          (select count(*) from jsonb_array_elements(p_filas) x where coalesce(trim(x->>'conductor'), '') = ''),
          p_archivo->>'origen',
          array(select distinct x->>'referencia' from jsonb_array_elements(p_filas) x
                where coalesce(x->>'referencia', '') <> ''))
  returning id into v_id;

  with x as (
    select distinct on (t.referencia) t.*, e.orden::int as orden
    from jsonb_array_elements(p_filas) with ordinality as e(fila, orden)
    cross join lateral jsonb_to_record(e.fila) as t(
      referencia text, tipo text, estado text, vehiculo text, conductor text, telefono text,
      descripcion text, monto numeric, pagado numeric, "creadoTexto" text)
    where coalesce(t.referencia, '') <> ''
    order by t.referencia, e.orden desc
  ), previa as (
    select distinct on (v.referencia) v.*
    from bills_versiones v
    join x on x.referencia = v.referencia
    where v.subido < v_subido
    order by v.referencia, v.subido desc
  ), cambiadas as (
    select x.*, p.referencia is null as nueva
    from x left join previa p on p.referencia = x.referencia
    where p.referencia is null
       or (p.tipo, p.estado, p.vehiculo, p.conductor, p.telefono, p.monto, p.pagado, p.creado_texto, p.descripcion)
          is distinct from (x.tipo, x.estado, x.vehiculo, x.conductor, x.telefono, coalesce(x.monto, 0), coalesce(x.pagado, 0),
                            x."creadoTexto", x.descripcion)
  ), ins as (
    insert into bills_versiones (referencia, archivo_id, subido, tipo, estado, vehiculo, conductor, telefono,
                                 descripcion, monto, pagado, creado_texto, orden)
    select referencia, v_id, v_subido, tipo, estado, vehiculo, conductor, telefono,
           descripcion, coalesce(monto, 0), coalesce(pagado, 0), "creadoTexto", orden
    from cambiadas
    returning 1
  )
  select count(*) filter (where nueva), count(*) filter (where not nueva) into v_nuevas, v_cambios
  from cambiadas where (select count(*) from ins) >= 0;

  update bills_archivos set nuevas = v_nuevas, cambios = v_cambios where id = v_id;
  return jsonb_build_object('archivo_id', v_id, 'nuevas', v_nuevas, 'cambios', v_cambios);
end $$;

create or replace function public.registrar_multas_version(p_archivo jsonb, p_filas jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
  v_subido timestamptz := (p_archivo->>'subido')::timestamptz;
  v_nuevas int;
  v_cambios int;
begin
  perform pg_advisory_xact_lock(hashtext('registrar_multas_version'));

  if exists (select 1 from multas_archivos
             where drive_id = p_archivo->>'driveId' or carga_id = (p_archivo->>'cargaId')::uuid) then
    return jsonb_build_object('ya_registrado', true);
  end if;

  insert into multas_archivos (archivo, drive_id, carga_id, subido, formato_desconocido, encabezado, filas, origen)
  values (p_archivo->>'archivo', p_archivo->>'driveId', (p_archivo->>'cargaId')::uuid, v_subido,
          coalesce((p_archivo->>'formatoDesconocido')::boolean, false),
          array(select jsonb_array_elements_text(coalesce(p_archivo->'encabezado', '[]'::jsonb))),
          jsonb_array_length(p_filas), p_archivo->>'origen')
  returning id into v_id;

  with x as (
    select distinct on (t.clave) t.*, e.orden::int as orden
    from jsonb_array_elements(p_filas) with ordinality as e(fila, orden)
    cross join lateral jsonb_to_record(e.fila) as t(
      clave text, base text, ref text, "fechaContravencion" text, cargo numeric, pago numeric,
      estado text, conductor text, vehiculo text, creado text, descripcion text)
    where coalesce(t.clave, '') <> ''
    order by t.clave, e.orden desc
  ), previa as (
    select distinct on (v.clave) v.*
    from multas_versiones v
    join x on x.clave = v.clave
    where v.subido < v_subido
    order by v.clave, v.subido desc
  ), cambiadas as (
    select x.*, p.clave is null as nueva
    from x left join previa p on p.clave = x.clave
    where p.clave is null
       or (p.base, p.referencia, p.fecha_contravencion, p.cargo, p.pago, p.estado, p.conductor, p.vehiculo, p.creado, p.descripcion)
          is distinct from (x.base, x.ref, x."fechaContravencion", coalesce(x.cargo, 0), coalesce(x.pago, 0),
                            x.estado, x.conductor, x.vehiculo, x.creado, x.descripcion)
  ), ins as (
    insert into multas_versiones (clave, archivo_id, subido, base, referencia, fecha_contravencion, cargo, pago,
                                  estado, conductor, vehiculo, creado, descripcion, orden)
    select clave, v_id, v_subido, base, ref, "fechaContravencion", coalesce(cargo, 0), coalesce(pago, 0),
           estado, conductor, vehiculo, creado, descripcion, orden
    from cambiadas
    returning 1
  )
  select count(*) filter (where nueva), count(*) filter (where not nueva) into v_nuevas, v_cambios
  from cambiadas where (select count(*) from ins) >= 0;

  update multas_archivos set nuevas = v_nuevas, cambios = v_cambios where id = v_id;
  return jsonb_build_object('archivo_id', v_id, 'nuevas', v_nuevas, 'cambios', v_cambios);
end $$;
