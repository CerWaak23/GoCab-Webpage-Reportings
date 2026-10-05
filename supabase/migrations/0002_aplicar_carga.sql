-- Aplica un export de Fleet en una sola transacción: o entra todo, o nada.
--
-- p_tipo     'vehicles' | 'drivers' | 'bills' | 'fines'
-- p_datos    filas ya normalizadas por src/lib/carga/payload.js
-- p_carga_id fila de public.cargas que se marca como aplicada
-- p_hoy      fecha de la carga (inicio o fin de asignaciones)
-- p_simular  true: hace todo y deshace al final (para pruebas); devuelve el
--            resultado en el detalle del error 'SIMULACION'
--
-- Manda Fleet: un auto que no viene en el archivo no se toca (solo se informa
-- como diferencia en src/lib/fleet). La primera carga marca las asignaciones
-- como 'preexistente' para que no cuenten como entrega pendiente.

create or replace function public.aplicar_carga(
  p_tipo text,
  p_datos jsonb,
  p_carga_id uuid,
  p_hoy date,
  p_simular boolean default false
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  fila jsonb;
  v_id uuid;
  v_vigente record;
  v_primera boolean := not exists (select 1 from asignaciones);
  v_nuevo boolean;
  r jsonb := jsonb_build_object(
    'tipo', p_tipo,
    'conductores_nuevos', 0, 'conductores_actualizados', 0,
    'autos_nuevos', 0, 'autos_actualizados', 0,
    'asignaciones_abiertas', 0, 'asignaciones_cerradas', 0,
    'primera_carga', v_primera
  );
begin
  if p_tipo not in ('vehicles', 'drivers', 'bills', 'fines') then
    raise exception 'Tipo de carga desconocido: %', p_tipo;
  end if;

  if p_tipo = 'drivers' then
    for fila in select * from jsonb_array_elements(p_datos) loop
      v_id := null;
      if fila->>'rut' is not null then
        select id into v_id from conductores where rut = fila->>'rut';
      end if;
      if v_id is null then
        select id into v_id from conductores
          where clave_nombre = fila->>'clave' and rut is null
          order by actualizado desc limit 1;
      end if;

      if v_id is null then
        insert into conductores (rut, rut_crudo, rut_valido, nombre, clave_nombre, telefono, licencia,
                                 vence_cedula, activacion, baja, grupo)
        values (fila->>'rut', fila->>'rutCrudo', coalesce((fila->>'rutValido')::boolean, false),
                fila->>'nombre', fila->>'clave', fila->>'telefono', fila->>'licencia',
                (fila->>'venceCedula')::date, (fila->>'activacion')::date, (fila->>'baja')::date, fila->>'grupo');
        r := jsonb_set(r, '{conductores_nuevos}', to_jsonb((r->>'conductores_nuevos')::int + 1));
      else
        update conductores set
          rut = coalesce(fila->>'rut', rut),
          rut_crudo = fila->>'rutCrudo',
          rut_valido = coalesce((fila->>'rutValido')::boolean, rut_valido),
          nombre = fila->>'nombre',
          clave_nombre = fila->>'clave',
          telefono = fila->>'telefono',
          licencia = fila->>'licencia',
          vence_cedula = (fila->>'venceCedula')::date,
          activacion = (fila->>'activacion')::date,
          baja = (fila->>'baja')::date,
          grupo = fila->>'grupo',
          provisional = false,
          actualizado = now()
        where id = v_id;
        r := jsonb_set(r, '{conductores_actualizados}', to_jsonb((r->>'conductores_actualizados')::int + 1));
      end if;
    end loop;
  end if;

  if p_tipo = 'vehicles' then
    for fila in select * from jsonb_array_elements(p_datos) loop
      v_nuevo := not exists (select 1 from autos where patente = fila->>'patente');
      insert into autos (patente, vin, marca, modelo, anio, color, estado_fleet, grupo, creado_fleet, fotos_ingreso_pendientes, actualizado)
      values (fila->>'patente', fila->>'vin', fila->>'marca', fila->>'modelo', (fila->>'anio')::int, fila->>'color',
              fila->>'estado', fila->>'grupo', (fila->>'creado')::date,
              v_nuevo and not v_primera and fila->>'conductor' is null and fila->>'estado' = 'available', now())
      on conflict (patente) do update set
        vin = excluded.vin, marca = excluded.marca, modelo = excluded.modelo, anio = excluded.anio,
        color = excluded.color, estado_fleet = excluded.estado_fleet, grupo = excluded.grupo,
        creado_fleet = excluded.creado_fleet, actualizado = now();
      if v_nuevo then
        r := jsonb_set(r, '{autos_nuevos}', to_jsonb((r->>'autos_nuevos')::int + 1));
      else
        r := jsonb_set(r, '{autos_actualizados}', to_jsonb((r->>'autos_actualizados')::int + 1));
      end if;

      -- conductor que Fleet asigna a este auto
      v_id := null;
      if fila->>'conductor' is not null then
        select id into v_id from conductores
          where clave_nombre = fila->>'clave'
          order by (rut is not null) desc, actualizado desc limit 1;
        if v_id is null then
          insert into conductores (nombre, clave_nombre) values (fila->>'conductor', fila->>'clave')
          returning id into v_id;
          r := jsonb_set(r, '{conductores_nuevos}', to_jsonb((r->>'conductores_nuevos')::int + 1));
        end if;
      end if;

      select * into v_vigente from asignaciones where patente = fila->>'patente' and hasta is null;
      if found and v_vigente.conductor_id is not distinct from v_id then
        continue;
      end if;
      if found then
        update asignaciones set hasta = p_hoy where id = v_vigente.id;
        r := jsonb_set(r, '{asignaciones_cerradas}', to_jsonb((r->>'asignaciones_cerradas')::int + 1));
      end if;
      if v_id is not null then
        insert into asignaciones (patente, conductor_id, desde, origen, carga_id)
        values (fila->>'patente', v_id, p_hoy, case when v_primera then 'preexistente' else 'fleet' end, p_carga_id);
        r := jsonb_set(r, '{asignaciones_abiertas}', to_jsonb((r->>'asignaciones_abiertas')::int + 1));
      end if;
    end loop;
  end if;

  update cargas set aplicada = true where id = p_carga_id;

  if p_simular then
    raise exception using message = 'SIMULACION', detail = r::text;
  end if;
  return r;
end $$;

revoke all on function public.aplicar_carga(text, jsonb, uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.aplicar_carga(text, jsonb, uuid, date, boolean) to service_role;
