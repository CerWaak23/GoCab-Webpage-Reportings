-- El teléfono también cuenta como cambio de una bill.
--
-- Sin esto, una bill a la que Fleet solo le cambiaba el teléfono quedaba con
-- el anterior (40 bills al comparar con el reporte de Drive). La historia se
-- vacía para volver a importarla desde Drive con scripts/importar-bills-drive.mjs;
-- TRUNCATE no pasa por el trigger que impide borrar versiones una a una.

truncate public.bills_versiones, public.bills_archivos restart identity;

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
    select distinct on (referencia) *
    from jsonb_to_recordset(p_filas) as t(
      referencia text, tipo text, estado text, vehiculo text, conductor text, telefono text,
      descripcion text, monto numeric, pagado numeric, "creadoTexto" text)
    where coalesce(referencia, '') <> ''
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
                                 descripcion, monto, pagado, creado_texto)
    select referencia, v_id, v_subido, tipo, estado, vehiculo, conductor, telefono,
           descripcion, coalesce(monto, 0), coalesce(pagado, 0), "creadoTexto"
    from cambiadas
    returning 1
  )
  select count(*) filter (where nueva), count(*) filter (where not nueva) into v_nuevas, v_cambios
  from cambiadas where (select count(*) from ins) >= 0;

  update bills_archivos set nuevas = v_nuevas, cambios = v_cambios where id = v_id;
  return jsonb_build_object('archivo_id', v_id, 'nuevas', v_nuevas, 'cambios', v_cambios);
end $$;

revoke all on function public.registrar_bills_version(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_bills_version(jsonb, jsonb) to service_role;
