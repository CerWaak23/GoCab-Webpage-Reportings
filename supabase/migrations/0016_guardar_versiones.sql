-- Guardar la historia de bills y multas sin buscar dentro de la base.
--
-- registrar_bills_version / registrar_multas_version comparaban cada fila con
-- su versión anterior dentro de la base, y eso se volvía más lento a medida
-- que crecía la historia (pasó los 60 s con 109 días de bills). Ahora GoBills
-- calcula qué cambió (src/lib/historia/versiones.js) y estas funciones solo
-- guardan el archivo y las filas nuevas, juntos o nada.

/**
 * p_archivo:   { archivo, driveId?, cargaId?, subido, origen, filas, filasSinConductor, referencias, nuevas, cambios }
 * p_versiones: [{ referencia, tipo, estado, vehiculo, conductor, telefono, descripcion, monto, pagado, creadoTexto, orden }]
 */
create or replace function public.guardar_bills_version(p_archivo jsonb, p_versiones jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
  v_subido timestamptz := (p_archivo->>'subido')::timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('registrar_bills_version'));

  if exists (select 1 from bills_archivos
             where drive_id = p_archivo->>'driveId' or carga_id = (p_archivo->>'cargaId')::uuid) then
    return jsonb_build_object('ya_registrado', true);
  end if;

  insert into bills_archivos (archivo, drive_id, carga_id, subido, dia, filas, filas_sin_conductor, origen,
                              referencias, nuevas, cambios)
  values (p_archivo->>'archivo', p_archivo->>'driveId', (p_archivo->>'cargaId')::uuid, v_subido,
          (v_subido at time zone 'America/Santiago')::date,
          coalesce((p_archivo->>'filas')::int, 0), coalesce((p_archivo->>'filasSinConductor')::int, 0),
          p_archivo->>'origen',
          array(select jsonb_array_elements_text(coalesce(p_archivo->'referencias', '[]'::jsonb))),
          coalesce((p_archivo->>'nuevas')::int, 0), coalesce((p_archivo->>'cambios')::int, 0))
  returning id into v_id;

  insert into bills_versiones (referencia, archivo_id, subido, tipo, estado, vehiculo, conductor, telefono,
                               descripcion, monto, pagado, creado_texto, orden)
  select referencia, v_id, v_subido, tipo, estado, vehiculo, conductor, telefono,
         descripcion, coalesce(monto, 0), coalesce(pagado, 0), "creadoTexto", orden
  from jsonb_to_recordset(p_versiones) as t(
    referencia text, tipo text, estado text, vehiculo text, conductor text, telefono text,
    descripcion text, monto numeric, pagado numeric, "creadoTexto" text, orden int);

  return jsonb_build_object('archivo_id', v_id,
    'nuevas', coalesce((p_archivo->>'nuevas')::int, 0), 'cambios', coalesce((p_archivo->>'cambios')::int, 0));
end $$;

/**
 * p_archivo:   { archivo, driveId?, cargaId?, subido, origen, formatoDesconocido, encabezado, filas, nuevas, cambios }
 * p_versiones: [{ clave, base, ref, fechaContravencion, cargo, pago, estado, conductor, vehiculo, creado, descripcion, orden }]
 */
create or replace function public.guardar_multas_version(p_archivo jsonb, p_versiones jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
  v_subido timestamptz := (p_archivo->>'subido')::timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('registrar_multas_version'));

  if exists (select 1 from multas_archivos
             where drive_id = p_archivo->>'driveId' or carga_id = (p_archivo->>'cargaId')::uuid) then
    return jsonb_build_object('ya_registrado', true);
  end if;

  insert into multas_archivos (archivo, drive_id, carga_id, subido, formato_desconocido, encabezado, filas,
                               origen, nuevas, cambios)
  values (p_archivo->>'archivo', p_archivo->>'driveId', (p_archivo->>'cargaId')::uuid, v_subido,
          coalesce((p_archivo->>'formatoDesconocido')::boolean, false),
          array(select jsonb_array_elements_text(coalesce(p_archivo->'encabezado', '[]'::jsonb))),
          coalesce((p_archivo->>'filas')::int, 0), p_archivo->>'origen',
          coalesce((p_archivo->>'nuevas')::int, 0), coalesce((p_archivo->>'cambios')::int, 0))
  returning id into v_id;

  insert into multas_versiones (clave, archivo_id, subido, base, referencia, fecha_contravencion, cargo, pago,
                                estado, conductor, vehiculo, creado, descripcion, orden)
  select clave, v_id, v_subido, base, ref, "fechaContravencion", coalesce(cargo, 0), coalesce(pago, 0),
         estado, conductor, vehiculo, creado, descripcion, orden
  from jsonb_to_recordset(p_versiones) as t(
    clave text, base text, ref text, "fechaContravencion" text, cargo numeric, pago numeric,
    estado text, conductor text, vehiculo text, creado text, descripcion text, orden int);

  return jsonb_build_object('archivo_id', v_id,
    'nuevas', coalesce((p_archivo->>'nuevas')::int, 0), 'cambios', coalesce((p_archivo->>'cambios')::int, 0));
end $$;

revoke all on function public.guardar_bills_version(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.guardar_multas_version(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_bills_version(jsonb, jsonb) to service_role;
grant execute on function public.guardar_multas_version(jsonb, jsonb) to service_role;
