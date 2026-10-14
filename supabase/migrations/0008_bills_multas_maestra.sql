-- Bills, multas y la maestra de Control Flota.
--
-- * bills y multas: hasta ahora la carga solo registraba el archivo; ahora
--   guarda cada fila (una por referencia de Fleet), con el conductor
--   identificado cuando se puede (src/lib/fleet/identidad.js).
-- * conductores.nombre_fleet / creado_fleet: el nombre tal como viene en Fleet
--   (con "PPD" si lo tiene) y su fecha de alta, que es lo que muestra la hoja
--   "Vehiculos y ConductoresII" y con lo que el reporte de Bills calza nombres.
-- * autos.grupo: si Fleet manda un auto sin grupo (al entrar a taller pierde
--   el conductor y a veces el coordinador), se mantiene el último conocido.
-- * maestra_ediciones: correcciones a mano de la maestra (encargado y tipo por
--   auto; nombre y RUT por conductor, porque Fleet trae RUT malos). Solo se
--   agregan filas: la última de cada campo manda, y un valor vacío vuelve al
--   dato de Fleet.

alter table public.conductores
  add column if not exists nombre_fleet text,
  add column if not exists creado_fleet date;

create table if not exists public.bills (
  referencia text primary key,
  tipo text,
  estado text,
  vehiculo text,
  patente text,
  conductor text,
  conductor_id uuid references public.conductores (id),
  telefono text,
  monto numeric not null default 0,
  pagado numeric not null default 0,
  cruces int,
  creado timestamp,
  carga_id uuid references public.cargas (id),
  actualizado timestamptz not null default now()
);
alter table public.bills enable row level security;
create index if not exists bills_conductor on public.bills (conductor_id);
create index if not exists bills_patente on public.bills (patente);
create index if not exists bills_creado on public.bills (creado);

create table if not exists public.multas (
  referencia text primary key,
  bill_referencia text,
  fecha date,
  creado timestamp,
  descripcion text,
  patente text,
  conductor text,
  conductor_id uuid references public.conductores (id),
  monto numeric not null default 0,
  pagado numeric not null default 0,
  saldo numeric not null default 0,
  estado text,
  lugar text,
  velocidad numeric,
  motivo_rechazo text,
  encargado text,
  grupo text,
  carga_id uuid references public.cargas (id),
  actualizado timestamptz not null default now()
);
alter table public.multas enable row level security;
create index if not exists multas_conductor on public.multas (conductor_id);
create index if not exists multas_patente on public.multas (patente);

create table if not exists public.maestra_ediciones (
  id bigint generated always as identity primary key,
  patente text references public.autos (patente),
  conductor_id uuid references public.conductores (id),
  campo text not null check (campo in ('encargado', 'tipo', 'nombre', 'rut')),
  valor text,
  autor_email citext not null,
  creado timestamptz not null default now(),
  check ((campo in ('encargado', 'tipo') and patente is not null)
      or (campo in ('nombre', 'rut') and conductor_id is not null))
);
alter table public.maestra_ediciones enable row level security;
create index if not exists maestra_ediciones_patente on public.maestra_ediciones (patente, campo, creado);
create index if not exists maestra_ediciones_conductor on public.maestra_ediciones (conductor_id, campo, creado);

drop trigger if exists maestra_ediciones_sin_cambios on public.maestra_ediciones;
create trigger maestra_ediciones_sin_cambios
  before update or delete on public.maestra_ediciones
  for each row execute function public.rechazar_cambios();

-- Cómo se llama en la hoja el grupo de Fleet (Manager Group) de cada auto.
insert into public.configuracion (clave, valor)
values ('maestra_encargados', '{"J.Varela": "J. Silva"}')
on conflict do nothing;

grant select, insert, update, delete on public.bills, public.multas to service_role;
grant select, insert on public.maestra_ediciones to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.bills, public.multas, public.maestra_ediciones from anon, authenticated;

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
  v_a int;
  v_b int;
  v_id uuid;
  v_rut_antes text;
  v_vigente record;
  v_previa record;
  v_primera boolean;
  v_nuevo boolean;
  v_ruts text[];
  v_pats text[];
  v_n int;
  r jsonb;
begin
  if p_tipo not in ('vehicles', 'drivers', 'bills', 'fines') then
    raise exception 'Tipo de carga desconocido: %', p_tipo;
  end if;

  -- Una carga a la vez: dos personas aplicando juntas no se pisan.
  perform pg_advisory_xact_lock(hashtext('aplicar_carga'));
  if exists (select 1 from cargas where id = p_carga_id and aplicada) then
    raise exception using message = 'YA_APLICADA';
  end if;

  v_primera := not exists (select 1 from asignaciones);
  r := jsonb_build_object(
    'tipo', p_tipo,
    'conductores_nuevos', 0, 'conductores_actualizados', 0, 'ruts_corregidos', 0,
    'filas_nuevas', 0, 'filas_actualizadas', 0,
    'autos_nuevos', 0, 'autos_actualizados', 0,
    'asignaciones_abiertas', 0, 'asignaciones_cerradas', 0, 'corregidas_mismo_dia', 0, 'reemplazos', 0,
    'primera_carga', v_primera
  );

  if p_tipo = 'drivers' then
    v_ruts := array(select x->>'rut' from jsonb_array_elements(p_datos) x where x->>'rut' is not null);

    for fila in select * from jsonb_array_elements(p_datos) loop
      v_id := null;
      v_pats := array(select jsonb_array_elements_text(coalesce(fila->'patentes', '[]'::jsonb)));
      if fila->>'rut' is not null then
        select id into v_id from conductores where rut = fila->>'rut';
      end if;
      -- Sin calce por RUT: el mismo nombre puede ser la misma persona con el RUT
      -- corregido, pero solo si su RUT anterior ya no viene en el archivo (si
      -- viene, es otra persona) y coincide su auto o su teléfono.
      if v_id is null then
        select id into v_id from conductores c
          where c.clave_nombre = fila->>'clave'
            and (c.rut is null
                 or (not c.rut = any(v_ruts)
                     and (c.patentes_fleet && v_pats or c.telefono = fila->>'telefono')))
          order by (c.patentes_fleet && v_pats) desc, c.actualizado desc
          limit 1;
      end if;

      if v_id is null then
        insert into conductores (rut, rut_crudo, rut_valido, nombre, clave_nombre, telefono, licencia,
                                 vence_cedula, activacion, baja, grupo, patentes_fleet,
                                 garantia_pagada, modalidad, nombre_fleet, creado_fleet)
        values (fila->>'rut', fila->>'rutCrudo', coalesce((fila->>'rutValido')::boolean, false),
                fila->>'nombre', fila->>'clave', fila->>'telefono', fila->>'licencia',
                (fila->>'venceCedula')::date, (fila->>'activacion')::date, (fila->>'baja')::date,
                fila->>'grupo', v_pats, (fila->>'garantia')::int, fila->>'modalidad',
                fila->>'nombreFleet', (fila->>'creado')::date);
        r := jsonb_set(r, '{conductores_nuevos}', to_jsonb((r->>'conductores_nuevos')::int + 1));
      else
        select rut into v_rut_antes from conductores where id = v_id;
        if fila->>'rut' is not null and v_rut_antes is distinct from fila->>'rut' then
          r := jsonb_set(r, '{ruts_corregidos}', to_jsonb((r->>'ruts_corregidos')::int + 1));
        end if;
        update conductores set
          rut = coalesce(fila->>'rut', rut),
          rut_crudo = fila->>'rutCrudo',
          rut_valido = case when fila->>'rut' is not null then true else rut is not null end,
          nombre = fila->>'nombre',
          clave_nombre = fila->>'clave',
          telefono = fila->>'telefono',
          licencia = fila->>'licencia',
          vence_cedula = (fila->>'venceCedula')::date,
          activacion = (fila->>'activacion')::date,
          baja = (fila->>'baja')::date,
          grupo = fila->>'grupo',
          patentes_fleet = v_pats,
          garantia_pagada = coalesce((fila->>'garantia')::int, garantia_pagada),
          modalidad = coalesce(fila->>'modalidad', modalidad),
          nombre_fleet = coalesce(fila->>'nombreFleet', nombre_fleet),
          creado_fleet = coalesce((fila->>'creado')::date, creado_fleet),
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
      insert into autos (patente, vin, marca, modelo, anio, color, estado_fleet, grupo, creado_fleet,
                         modalidad, fotos_ingreso_pendientes, actualizado)
      values (fila->>'patente', fila->>'vin', fila->>'marca', fila->>'modelo', (fila->>'anio')::int, fila->>'color',
              fila->>'estado', fila->>'grupo', (fila->>'creado')::date, fila->>'modalidad',
              v_nuevo and not v_primera and fila->>'conductor' is null and fila->>'estado' = 'available', now())
      on conflict (patente) do update set
        vin = excluded.vin, marca = excluded.marca, modelo = excluded.modelo, anio = excluded.anio,
        color = excluded.color, estado_fleet = excluded.estado_fleet,
        grupo = coalesce(excluded.grupo, autos.grupo),
        creado_fleet = excluded.creado_fleet,
        modalidad = coalesce(excluded.modalidad, autos.modalidad),
        actualizado = now();
      if v_nuevo then
        r := jsonb_set(r, '{autos_nuevos}', to_jsonb((r->>'autos_nuevos')::int + 1));
      else
        r := jsonb_set(r, '{autos_actualizados}', to_jsonb((r->>'autos_actualizados')::int + 1));
      end if;

      -- Conductor que Fleet asigna a este auto. Lo identifica el servidor
      -- (src/lib/fleet/identidad.js: teléfono, nombre, palabras, patente); si
      -- no pudo, se busca por nombre exacto prefiriendo el que tiene esta
      -- patente en el export de conductores, y si no existe se crea.
      v_id := null;
      if fila->>'conductorId' is not null then
        select id into v_id from conductores where id = (fila->>'conductorId')::uuid;
      end if;
      if v_id is null and fila->>'conductor' is not null then
        select id into v_id from conductores
          where clave_nombre = fila->>'clave'
          order by coalesce(fila->>'patente' = any(patentes_fleet), false) desc,
                   (baja is null) desc, (rut is not null) desc, actualizado desc
          limit 1;
        if v_id is null then
          insert into conductores (nombre, clave_nombre, patentes_fleet)
          values (fila->>'conductor', fila->>'clave', array[fila->>'patente'])
          returning id into v_id;
          r := jsonb_set(r, '{conductores_nuevos}', to_jsonb((r->>'conductores_nuevos')::int + 1));
        end if;
      end if;

      select * into v_vigente from asignaciones where patente = fila->>'patente' and hasta is null;
      if found and v_vigente.conductor_id is not distinct from v_id then
        continue;
      end if;

      -- Cambio sobre una asignación abierta hoy por otra carga: es una
      -- corrección del mismo día, no un traspaso real.
      if found and v_id is not null and v_vigente.desde = p_hoy
         and v_vigente.carga_id is distinct from p_carga_id then
        select * into v_previa from asignaciones
          where patente = fila->>'patente' and hasta = p_hoy and conductor_id = v_id
          order by creado desc limit 1;
        if found then
          -- vuelve al conductor de antes: se reabre su asignación
          delete from asignaciones where id = v_vigente.id;
          update asignaciones set hasta = null where id = v_previa.id;
        else
          update asignaciones set conductor_id = v_id, carga_id = p_carga_id where id = v_vigente.id;
        end if;
        r := jsonb_set(r, '{corregidas_mismo_dia}', to_jsonb((r->>'corregidas_mismo_dia')::int + 1));
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

    -- Auto de reemplazo. Se calcula al final, cuando ya se cerraron los autos
    -- devueltos, para que un simple cambio de auto no cuente como reemplazo:
    --  1. lo normal: el auto anterior del conductor se cerró hoy y Fleet lo
    --     tiene en mantención (al entrar a taller Fleet le quita el conductor);
    --  2. Fleet le dejó los dos autos: el anterior sigue vigente (y no era a su
    --     vez un reemplazo, para que la vuelta del taller no cuente al revés).
    -- Igual es una entrega y pide su acta como cualquier otra.
    update asignaciones a set reemplazo = true, reemplaza_patente = x.patente
    from (
      select n.id, coalesce(
        (select o.patente from asignaciones o join autos au on au.patente = o.patente
          where o.conductor_id = n.conductor_id and o.id <> n.id and o.hasta = p_hoy
            and au.estado_fleet = 'maintenance'
          order by o.creado desc limit 1),
        (select o.patente from asignaciones o
          where o.conductor_id = n.conductor_id and o.id <> n.id and o.hasta is null
            and not o.reemplazo and o.carga_id is distinct from p_carga_id
          order by o.desde limit 1)
      ) as patente
      from asignaciones n
      where n.carga_id = p_carga_id and n.hasta is null and n.origen = 'fleet'
    ) x
    where a.id = x.id and x.patente is not null;
    get diagnostics v_n = row_count;
    r := jsonb_set(r, '{reemplazos}', to_jsonb(v_n));
  end if;

  -- Bills y multas: una fila por referencia. Un export puede traer solo un
  -- rango de fechas, así que nunca se borra: se agrega o se actualiza.
  if p_tipo = 'bills' then
    with x as (
      select * from jsonb_to_recordset(p_datos) as t(
        referencia text, tipo text, estado text, vehiculo text, patente text, conductor text,
        "conductorId" uuid, telefono text, monto numeric, pagado numeric, cruces int, creado timestamp)
    ), up as (
      insert into bills as b (referencia, tipo, estado, vehiculo, patente, conductor, conductor_id, telefono,
                              monto, pagado, cruces, creado, carga_id, actualizado)
      select referencia, tipo, estado, vehiculo, patente, conductor, "conductorId", telefono,
             monto, pagado, cruces, creado, p_carga_id, now()
      from x where referencia is not null
      on conflict (referencia) do update set
        tipo = excluded.tipo, estado = excluded.estado, vehiculo = excluded.vehiculo, patente = excluded.patente,
        conductor = excluded.conductor, conductor_id = coalesce(excluded.conductor_id, b.conductor_id),
        telefono = excluded.telefono, monto = excluded.monto, pagado = excluded.pagado, cruces = excluded.cruces,
        creado = excluded.creado, carga_id = excluded.carga_id, actualizado = now()
      where (b.tipo, b.estado, b.patente, b.conductor, b.monto, b.pagado, b.cruces)
            is distinct from (excluded.tipo, excluded.estado, excluded.patente, excluded.conductor,
                              excluded.monto, excluded.pagado, excluded.cruces)
      returning (xmax = 0) as nueva
    )
    select count(*) filter (where nueva), count(*) filter (where not nueva) into v_a, v_b from up;
    r := r || jsonb_build_object('filas_nuevas', v_a, 'filas_actualizadas', v_b);
  end if;

  if p_tipo = 'fines' then
    with x as (
      select * from jsonb_to_recordset(p_datos) as t(
        referencia text, "billReferencia" text, fecha date, creado timestamp, descripcion text, patente text,
        conductor text, "conductorId" uuid, monto numeric, pagado numeric, saldo numeric, estado text,
        lugar text, velocidad numeric, "motivoRechazo" text, encargado text, grupo text)
    ), up as (
      insert into multas as m (referencia, bill_referencia, fecha, creado, descripcion, patente, conductor,
                               conductor_id, monto, pagado, saldo, estado, lugar, velocidad, motivo_rechazo,
                               encargado, grupo, carga_id, actualizado)
      select referencia, "billReferencia", fecha, creado, descripcion, patente, conductor,
             "conductorId", monto, pagado, saldo, estado, lugar, velocidad, "motivoRechazo",
             encargado, grupo, p_carga_id, now()
      from x where referencia is not null
      on conflict (referencia) do update set
        bill_referencia = excluded.bill_referencia, fecha = excluded.fecha, creado = excluded.creado,
        descripcion = excluded.descripcion, patente = excluded.patente, conductor = excluded.conductor,
        conductor_id = coalesce(excluded.conductor_id, m.conductor_id), monto = excluded.monto,
        pagado = excluded.pagado, saldo = excluded.saldo, estado = excluded.estado, lugar = excluded.lugar,
        velocidad = excluded.velocidad, motivo_rechazo = excluded.motivo_rechazo,
        encargado = excluded.encargado, grupo = excluded.grupo, carga_id = excluded.carga_id, actualizado = now()
      where (m.estado, m.patente, m.conductor, m.monto, m.pagado, m.saldo, m.motivo_rechazo)
            is distinct from (excluded.estado, excluded.patente, excluded.conductor, excluded.monto,
                              excluded.pagado, excluded.saldo, excluded.motivo_rechazo)
      returning (xmax = 0) as nueva
    )
    select count(*) filter (where nueva), count(*) filter (where not nueva) into v_a, v_b from up;
    r := r || jsonb_build_object('filas_nuevas', v_a, 'filas_actualizadas', v_b);
  end if;

  -- La modalidad es del contrato del conductor: pasa a su auto vigente, salvo
  -- que sea uno de reemplazo (ese sigue siendo de la empresa).
  if p_tipo in ('drivers', 'vehicles') then
    update autos au set modalidad = c.modalidad
    from asignaciones s join conductores c on c.id = s.conductor_id
    where s.patente = au.patente and s.hasta is null and not s.reemplazo
      and c.modalidad is not null and au.modalidad is distinct from c.modalidad;
    get diagnostics v_n = row_count;
    r := jsonb_set(r, '{modalidades_actualizadas}', to_jsonb(v_n));
  end if;

  update cargas set aplicada = true where id = p_carga_id;

  if p_simular then
    raise exception using message = 'SIMULACION', detail = r::text;
  end if;
  return r;
end $$;

revoke all on function public.aplicar_carga(text, jsonb, uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.aplicar_carga(text, jsonb, uuid, date, boolean) to service_role;
