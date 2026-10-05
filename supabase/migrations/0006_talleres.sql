-- Talleres (U9, R56-R60).
--
-- * talleres: catálogo editable, con la marca que atiende y para qué
--   (mantención, siniestro o ambos). Semilla del protocolo del prototipo.
-- * Cada paso por taller es un evento tipo 'taller' del auto; su detalle
--   guarda el ingreso y, al cerrar, la salida. Un solo paso abierto por auto.
-- * taller_actualizaciones: lo que va informando el encargado. Solo se
--   agregan filas: no se cambian ni se borran (quedan como registro).

create table if not exists public.talleres (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  marca text,                                   -- BAIC, Neta, Nammi; null = cualquiera
  para text not null default 'ambos' check (para in ('mantencion', 'siniestro', 'ambos')),
  activo boolean not null default true,
  creado timestamptz not null default now()
);
alter table public.talleres enable row level security;

insert into public.talleres (nombre, marca, para) values
  ('FullMec', 'BAIC', 'mantencion'),
  ('Grass Macul', 'BAIC', 'siniestro'),
  ('Kaufmann Las Parcelas', 'Neta', 'ambos'),
  ('Kaufmann DyP', 'Neta', 'siniestro'),
  ('Indumotora Huechuraba', 'Nammi', 'mantencion'),
  ('Indumotora Santiago Centro', 'Nammi', 'siniestro'),
  ('Otro taller', null, 'ambos')
on conflict (nombre) do nothing;

create table if not exists public.taller_actualizaciones (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.eventos (id),
  fecha timestamptz not null default now(),
  autor_email citext not null,
  texto text not null,
  estado text check (estado in ('diagnostico', 'presupuesto', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion', 'listo_retiro')),
  monto numeric check (monto is null or monto >= 0)
);
alter table public.taller_actualizaciones enable row level security;
create index if not exists taller_actualizaciones_evento on public.taller_actualizaciones (evento_id, fecha);

drop trigger if exists taller_actualizaciones_sin_cambios on public.taller_actualizaciones;
create trigger taller_actualizaciones_sin_cambios
  before update or delete on public.taller_actualizaciones
  for each row execute function public.rechazar_cambios();

-- Un solo paso por taller abierto por auto.
create unique index if not exists un_taller_abierto_por_auto
  on public.eventos (patente) where tipo = 'taller' and not (detalle ? 'salida');

grant select, insert, update, delete on public.talleres to service_role;
grant select, insert on public.taller_actualizaciones to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.talleres, public.taller_actualizaciones from anon, authenticated;
