-- Peajes del GPS: el "Listado de TAGs" de la plataforma del GPS, una fila por
-- pasada por pórtico, para compararlo con lo que Fleet carga en los bills.
--
-- El export pesa ~70 MB (más que el límite de Storage), así que no se guarda el
-- archivo: el navegador lo lee y manda las pasadas en lotes. Los exports se
-- pisan entre sí; una pasada es patente + hora de entrada + pórtico, y si ya
-- está no se vuelve a insertar.

create table if not exists public.gps_cargas (
  id uuid primary key default gen_random_uuid(),
  archivo text not null,
  filas int not null default 0,          -- pasadas en el archivo
  nuevas int not null default 0,         -- las que no estaban
  desde timestamp,                       -- primera y última pasada del archivo
  hasta timestamp,
  terminada boolean not null default false,
  usuario_email citext not null,
  creado timestamptz not null default now()
);
alter table public.gps_cargas enable row level security;

create table if not exists public.gps_pasadas (
  id bigint generated always as identity primary key,
  patente text not null,
  entrada timestamp not null,            -- hora de pórtico, tal como la escribe el GPS
  salida timestamp,
  imei text,
  tipo_autopista text,
  autopista text,
  portico text not null default '',
  tipo_tarifa text,
  valor int not null,
  carga_id uuid references public.gps_cargas (id),
  unique (patente, entrada, portico)
);
create index if not exists gps_pasadas_entrada on public.gps_pasadas (entrada);
create index if not exists gps_pasadas_carga on public.gps_pasadas (carga_id);
alter table public.gps_pasadas enable row level security;

grant select, insert, update on public.gps_cargas to service_role;
grant select, insert on public.gps_pasadas to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.gps_cargas, public.gps_pasadas from anon, authenticated;

/** Suma del GPS por auto y día desde una fecha: es lo que se compara con los bills. */
create or replace function public.gps_por_dia(p_desde date)
returns table (patente text, dia date, monto bigint, pasadas int)
language sql
stable
set search_path = public
as $$
  select patente, entrada::date, sum(valor)::bigint, count(*)::int
  from gps_pasadas
  where entrada >= p_desde
  group by 1, 2
  order by 2, 1
$$;

/** Cierra una carga: cuántas pasadas eran nuevas, contadas en la base. */
create or replace function public.cerrar_gps_carga(p_carga_id uuid)
returns int
language sql
set search_path = public
as $$
  update gps_cargas
  set nuevas = (select count(*) from gps_pasadas where carga_id = p_carga_id),
      terminada = true
  where id = p_carga_id
  returning nuevas
$$;

revoke all on function public.gps_por_dia(date), public.cerrar_gps_carga(uuid) from public, anon, authenticated;
grant execute on function public.gps_por_dia(date), public.cerrar_gps_carga(uuid) to service_role;
