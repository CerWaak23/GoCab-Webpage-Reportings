-- GoBills · Historial de vehículos · esquema base
--
-- Todo acceso a datos pasa por el servidor de GoBills con la clave secreta.
-- RLS queda activado en todas las tablas y sin políticas: con la clave
-- publicable (la del navegador) no se puede leer ni escribir nada.

create extension if not exists citext;

-- ---------- usuarios internos y roles ----------
create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique check (email like '%@gocab.io'),
  nombre text not null,
  rol text not null check (rol in ('gerencia', 'coordinador', 'taller', 'admin')),
  ve_deudas boolean not null default false,
  activo boolean not null default true,
  creado timestamptz not null default now()
);
alter table public.usuarios enable row level security;

-- ---------- flota (fuente: exports de Fleet) ----------
create table if not exists public.autos (
  patente text primary key check (patente ~ '^[A-Z0-9]+$'),
  vin text,
  marca text,
  modelo text,
  anio int,
  color text,
  estado_fleet text,
  grupo text,
  creado_fleet date,
  fotos_ingreso_pendientes boolean not null default false,
  actualizado timestamptz not null default now()
);
alter table public.autos enable row level security;

create table if not exists public.conductores (
  id uuid primary key default gen_random_uuid(),
  rut text unique,                       -- 12.345.678-9; null si Fleet trae un RUT inválido
  rut_crudo text,
  rut_valido boolean not null default false,
  nombre text not null,
  clave_nombre text not null,            -- nombre normalizado para comparar
  telefono text,
  licencia text,
  vence_cedula date,
  activacion date,
  baja date,
  grupo text,
  cedula_registrada boolean not null default false,
  provisional boolean not null default false,
  actualizado timestamptz not null default now()
);
create index if not exists conductores_clave_nombre on public.conductores (clave_nombre);
alter table public.conductores enable row level security;

create table if not exists public.cargas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('vehicles', 'drivers', 'bills', 'fines')),
  archivo text not null,
  ruta_storage text not null,
  filas int not null,
  resumen jsonb not null default '{}',
  diferencias jsonb not null default '[]',
  aplicada boolean not null default false,
  usuario_email citext not null,
  creado timestamptz not null default now()
);
alter table public.cargas enable row level security;

create table if not exists public.asignaciones (
  id uuid primary key default gen_random_uuid(),
  patente text not null references public.autos (patente),
  conductor_id uuid not null references public.conductores (id),
  desde date not null,
  hasta date,
  origen text not null check (origen in ('fleet', 'preexistente', 'provisional')),
  carga_id uuid references public.cargas (id),
  creado timestamptz not null default now(),
  check (hasta is null or hasta >= desde)
);
create unique index if not exists asignacion_vigente_por_auto on public.asignaciones (patente) where hasta is null;
alter table public.asignaciones enable row level security;

-- ---------- historia del auto ----------
create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  patente text not null references public.autos (patente),
  conductor_id uuid references public.conductores (id),
  tipo text not null check (tipo in ('ingreso', 'entrega', 'recepcion', 'levantamiento', 'revision', 'siniestro', 'taller')),
  fecha timestamptz not null,
  usuario_email citext,                  -- null cuando lo envía el conductor desde el portal
  firmado boolean not null default false,
  checklist_version int,
  version_aviso text,
  detalle jsonb not null default '{}',
  pdf_ruta text,
  pdf_hash text,
  sincronizado timestamptz,
  creado timestamptz not null default now()
);
create index if not exists eventos_patente_fecha on public.eventos (patente, fecha desc);
create index if not exists eventos_conductor on public.eventos (conductor_id);
alter table public.eventos enable row level security;

create table if not exists public.archivos (
  id uuid primary key default gen_random_uuid(),
  clase text not null check (clase in ('foto', 'documento', 'cedula', 'firma', 'acta', 'factura', 'siniestro_doc')),
  bucket text not null check (bucket in ('fotos', 'documentos', 'actas', 'cargas')),
  ruta text not null unique,
  evento_id uuid references public.eventos (id),
  patente text references public.autos (patente),
  conductor_id uuid references public.conductores (id),
  toma text,                              -- id de la toma guiada (frente, trasera…)
  sha256 text,
  tomada_en timestamptz,                  -- hora del teléfono
  recibida_en timestamptz not null default now(),
  vence date,
  metadatos jsonb not null default '{}'
);
alter table public.archivos enable row level security;

create table if not exists public.notas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos (id),
  autor_email citext not null,
  texto text not null,
  creado timestamptz not null default now()
);
alter table public.notas enable row level security;

create table if not exists public.pendientes (
  id uuid primary key default gen_random_uuid(),
  patente text not null references public.autos (patente),
  conductor_id uuid references public.conductores (id),
  evento_id uuid references public.eventos (id),
  texto text not null,
  estado text not null default 'Sin monto',
  monto numeric,
  creado timestamptz not null default now()
);
alter table public.pendientes enable row level security;

create table if not exists public.checklists (
  version int primary key,
  items jsonb not null,
  creada_por citext not null,
  creado timestamptz not null default now()
);
alter table public.checklists enable row level security;

create table if not exists public.configuracion (
  clave text primary key,
  valor jsonb not null
);
alter table public.configuracion enable row level security;
insert into public.configuracion (clave, valor) values ('revision_dias', '30') on conflict do nothing;

-- ---------- registro de accesos (append-only) ----------
create table if not exists public.registro_accesos (
  id bigint generated always as identity primary key,
  usuario_email citext not null,
  archivo_id uuid references public.archivos (id),
  accion text not null check (accion in ('ver', 'descargar')),
  en timestamptz not null default now()
);
alter table public.registro_accesos enable row level security;
revoke update, delete on public.registro_accesos from anon, authenticated, service_role;

create or replace function public.rechazar_cambios() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % no admite cambios ni borrados', tg_table_name;
end $$;

drop trigger if exists registro_accesos_inmutable on public.registro_accesos;
create trigger registro_accesos_inmutable
  before update or delete on public.registro_accesos
  for each row execute function public.rechazar_cambios();

-- ---------- almacenamiento privado ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('fotos', 'fotos', false, 10485760, array['image/jpeg', 'image/webp', 'image/png']),
  ('documentos', 'documentos', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('actas', 'actas', false, 20971520, array['application/pdf']),
  ('cargas', 'cargas', false, 10485760, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'])
on conflict (id) do nothing;
