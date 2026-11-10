-- Vacaciones del equipo (nov-2026). Cada uno pide las suyas; las de un
-- coordinador quedan "solicitada" hasta que gerencia las apruebe o rechace, y
-- las de gerencia quedan aprobadas al tiro. Todos ven el calendario.

create table if not exists public.vacaciones (
  id bigint generated always as identity primary key,
  usuario_email citext not null,
  nombre text not null,
  desde date not null,
  hasta date not null,
  dias int not null,                       -- días hábiles (sin fines de semana ni feriados)
  nota text,
  estado text not null check (estado in ('solicitada', 'aprobada', 'rechazada', 'cancelada')),
  motivo text,                             -- por qué se rechazó
  creado timestamptz not null default now(),
  revisado_por citext,
  revisado_en timestamptz,
  check (hasta >= desde)
);
create index if not exists vacaciones_fechas on public.vacaciones (desde, hasta);
alter table public.vacaciones enable row level security;

grant select, insert, update on public.vacaciones to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.vacaciones from anon, authenticated;
