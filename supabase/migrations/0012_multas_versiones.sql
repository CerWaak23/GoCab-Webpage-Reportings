-- Historia de multas: qué decía cada export, para saber cuándo se pagó o se
-- abonó cada multa (igual que 0009 para bills).
--
-- El reporte de multas recorre todos los exports en orden: un pago es la
-- subida del monto pagado o la baja del monto de la multa (los abonos se
-- registran rebajándola a mano). Aquí queda cada export (multas_archivos) y
-- cada multa solo cuando algo cambió (multas_versiones), ya leída con
-- src/lib/multas/reporte.js#multasDeFilas, clave incluida.

create table if not exists public.multas_archivos (
  id bigint generated always as identity primary key,
  archivo text not null,
  drive_id text unique,
  carga_id uuid unique references public.cargas (id),
  subido timestamptz not null,
  formato_desconocido boolean not null default false,
  encabezado text[],
  filas int not null default 0,
  nuevas int not null default 0,
  cambios int not null default 0,
  origen text not null check (origen in ('drive', 'carga')),
  creado timestamptz not null default now()
);
alter table public.multas_archivos enable row level security;
create index if not exists multas_archivos_subido on public.multas_archivos (subido);

create table if not exists public.multas_versiones (
  id bigint generated always as identity primary key,
  clave text not null,                    -- referencia|fecha (y #n si se repite en el archivo)
  archivo_id bigint not null references public.multas_archivos (id),
  subido timestamptz not null,
  base text not null,
  referencia text not null,
  fecha_contravencion text,
  cargo numeric not null default 0,
  pago numeric not null default 0,
  estado text,
  conductor text,
  vehiculo text,
  creado text,
  descripcion text,
  unique (clave, archivo_id)
);
alter table public.multas_versiones enable row level security;
create index if not exists multas_versiones_clave on public.multas_versiones (clave, subido desc);

drop trigger if exists multas_versiones_sin_cambios on public.multas_versiones;
create trigger multas_versiones_sin_cambios
  before update or delete on public.multas_versiones
  for each row execute function public.rechazar_cambios();

/**
 * Guarda un export de multas ya leído: el archivo y las multas que cambiaron
 * respecto de su versión anterior. Si el archivo ya estaba, no hace nada.
 *
 * p_archivo: { archivo, driveId?, cargaId?, subido, origen, formatoDesconocido, encabezado }
 * p_filas:   [{ clave, base, ref, fechaContravencion, cargo, pago, estado, conductor, vehiculo, creado, descripcion }]
 */
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
    select distinct on (clave) *
    from jsonb_to_recordset(p_filas) as t(
      clave text, base text, ref text, "fechaContravencion" text, cargo numeric, pago numeric,
      estado text, conductor text, vehiculo text, creado text, descripcion text)
    where coalesce(clave, '') <> ''
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
                                  estado, conductor, vehiculo, creado, descripcion)
    select clave, v_id, v_subido, base, ref, "fechaContravencion", coalesce(cargo, 0), coalesce(pago, 0),
           estado, conductor, vehiculo, creado, descripcion
    from cambiadas
    returning 1
  )
  select count(*) filter (where nueva), count(*) filter (where not nueva) into v_nuevas, v_cambios
  from cambiadas where (select count(*) from ins) >= 0;

  update multas_archivos set nuevas = v_nuevas, cambios = v_cambios where id = v_id;
  return jsonb_build_object('archivo_id', v_id, 'nuevas', v_nuevas, 'cambios', v_cambios);
end $$;

grant select, insert on public.multas_archivos, public.multas_versiones to service_role;
grant update (nuevas, cambios) on public.multas_archivos to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.multas_archivos, public.multas_versiones from anon, authenticated;
revoke all on function public.registrar_multas_version(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_multas_version(jsonb, jsonb) to service_role;
