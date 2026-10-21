-- Despedidos: el export de conductores despedidos de Fleet y lo que registran
-- los coordinadores para liquidarlos.
--
-- El export tiene las mismas columnas que el de conductores pero todos vienen
-- con "Activation Status" = fired. Va a su propia tabla y no a conductores, para
-- que una carga de despedidos no reescriba la maestra de Control Flota.

alter table public.cargas drop constraint if exists cargas_tipo_check;
alter table public.cargas add constraint cargas_tipo_check
  check (tipo in ('vehicles', 'drivers', 'bills', 'fines', 'despedidos'));

-- Lo que trae Fleet, el último export aplicado manda. clave = 'rut:<rut>' o
-- 'nom:<nombre normalizado>' si el RUT no es válido.
create table if not exists public.despedidos (
  clave text primary key,
  rut text,
  nombre text not null,
  nombre_fleet text,
  telefono text,
  activacion date,
  despido date,
  balance int not null default 0,   -- negativo: renta adeudada; positivo: renta pagada por adelantado
  garantia int not null default 0,  -- Bail paid
  comentario text,
  carga_id uuid references public.cargas (id),
  actualizado timestamptz not null default now()
);
alter table public.despedidos enable row level security;

-- Lo que registra el coordinador. Separado de lo de Fleet para que una carga
-- nueva no borre lo que la gente escribió.
create table if not exists public.despedidos_gestion (
  clave text primary key,
  ajustes jsonb not null default '[]',      -- [{ id, monto, concepto, nota, por, fecha }]
  devuelto int not null default 0,           -- garantía ya devuelta
  devuelto_fecha date,
  anexo_dicom boolean not null default false,
  anexo_por citext,
  anexo_fecha timestamptz,
  nota text,
  actualizado timestamptz not null default now(),
  actualizado_por citext
);
alter table public.despedidos_gestion enable row level security;

grant select, insert, update, delete on public.despedidos, public.despedidos_gestion to service_role;
revoke all on public.despedidos, public.despedidos_gestion from anon, authenticated;

/**
 * Aplica un export de despedidos: una fila por despedido, todo o nada.
 * p_datos: [{ clave, rut, nombre, nombreFleet, telefono, activacion, despido, balance, garantia, comentario }]
 */
create or replace function public.aplicar_despedidos(p_datos jsonb, p_carga_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_nuevos int;
  v_total int;
begin
  -- El mismo candado que aplicar_carga: una carga a la vez
  perform pg_advisory_xact_lock(hashtext('aplicar_carga'));
  if exists (select 1 from cargas where id = p_carga_id and aplicada) then
    raise exception using message = 'YA_APLICADA';
  end if;

  select count(*) into v_nuevos
  from jsonb_array_elements(p_datos) f
  where not exists (select 1 from despedidos d where d.clave = f->>'clave');

  insert into despedidos (clave, rut, nombre, nombre_fleet, telefono, activacion, despido,
                          balance, garantia, comentario, carga_id, actualizado)
  select f->>'clave', f->>'rut', f->>'nombre', f->>'nombreFleet', f->>'telefono',
         (f->>'activacion')::date, (f->>'despido')::date,
         coalesce((f->>'balance')::int, 0), coalesce((f->>'garantia')::int, 0),
         f->>'comentario', p_carga_id, now()
  from jsonb_array_elements(p_datos) f
  where coalesce(f->>'clave', '') <> ''
  on conflict (clave) do update set
    rut = excluded.rut, nombre = excluded.nombre, nombre_fleet = excluded.nombre_fleet,
    telefono = excluded.telefono, activacion = excluded.activacion, despido = excluded.despido,
    balance = excluded.balance, garantia = excluded.garantia, comentario = excluded.comentario,
    carga_id = excluded.carga_id, actualizado = now();
  get diagnostics v_total = row_count;

  update cargas set aplicada = true where id = p_carga_id;
  return jsonb_build_object('tipo', 'despedidos', 'filas_nuevas', v_nuevos, 'filas_actualizadas', v_total - v_nuevos);
end $$;

revoke all on function public.aplicar_despedidos(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.aplicar_despedidos(jsonb, uuid) to service_role;
