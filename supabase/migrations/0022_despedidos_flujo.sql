-- Despedidos: renta al momento del despido, correcciones con aprobación y
-- estados de cierre (nov-2026).
--
-- * conductores_balances: el Balance de cada conductor en cada export de
--   conductores activos. Fleet deja el Balance en 0 al despedir, así que la renta
--   que debía se saca del último export en que figuraba activo.
-- * despedidos_cambios: correcciones a mano de una casilla (renta, tags, multas,
--   otros, garantía, ajustes). Las de gerencia quedan aprobadas; las de un
--   coordinador quedan pendientes hasta que gerencia las apruebe o rechace.
-- * despedidos_gestion.listo / cerrado: el coordinador marca que está listo para
--   devolver o para publicar en DICOM; gerencia marca que ya se devolvió o publicó.

create table if not exists public.conductores_balances (
  id bigint generated always as identity primary key,
  carga_id uuid references public.cargas (id),
  fecha timestamptz not null,           -- cuándo se subió el export
  rut text,                             -- 12.345.678-9 si es válido
  clave_nombre text not null,           -- nombre normalizado
  nombre text not null,
  patente text,
  balance int not null,                 -- negativo: renta que debe
  garantia int,
  unique (carga_id, clave_nombre)
);
create index if not exists conductores_balances_rut on public.conductores_balances (rut, fecha desc);
create index if not exists conductores_balances_nombre on public.conductores_balances (clave_nombre, fecha desc);
alter table public.conductores_balances enable row level security;

create table if not exists public.despedidos_cambios (
  id bigint generated always as identity primary key,
  clave text not null references public.despedidos (clave),
  campo text not null check (campo in ('renta', 'tags', 'multas', 'otros', 'garantia', 'ajustes')),
  valor int not null,                   -- renta: positivo debe, negativo a favor
  anterior int,                         -- lo que mostraba la casilla al proponerlo
  nota text,
  estado text not null check (estado in ('pendiente', 'aprobado', 'rechazado')),
  propuesto_por citext not null,
  propuesto_en timestamptz not null default now(),
  revisado_por citext,
  revisado_en timestamptz
);
create index if not exists despedidos_cambios_clave on public.despedidos_cambios (clave, campo, propuesto_en desc);
alter table public.despedidos_cambios enable row level security;

alter table public.despedidos_gestion add column if not exists listo boolean not null default false;
alter table public.despedidos_gestion add column if not exists listo_por citext;
alter table public.despedidos_gestion add column if not exists listo_en timestamptz;
alter table public.despedidos_gestion add column if not exists cerrado boolean not null default false;
alter table public.despedidos_gestion add column if not exists cerrado_tipo text check (cerrado_tipo in ('devuelto', 'dicom'));
alter table public.despedidos_gestion add column if not exists cerrado_monto int;
alter table public.despedidos_gestion add column if not exists cerrado_por citext;
alter table public.despedidos_gestion add column if not exists cerrado_en timestamptz;

grant select, insert, update on public.conductores_balances, public.despedidos_cambios to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.conductores_balances, public.despedidos_cambios from anon, authenticated;
