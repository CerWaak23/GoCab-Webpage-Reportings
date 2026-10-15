-- Historia de bills: qué decía cada export, para saber cuándo se pagó cada bill.
--
-- El reporte de Bills compara el último export de cada día con el anterior: si
-- el pagado de una bill subió, ese día hubo un pago. La tabla bills (0008) solo
-- guarda el estado más reciente, así que esa historia vive aquí:
--
-- * bills_archivos: cada export leído (de la carpeta de Drive o de Carga de
--   datos), con la hora en que se subió, que es la fecha del pago.
-- * bills_versiones: una fila por bill solo cuando algo cambió respecto de su
--   versión anterior (aparece, cambia el pagado, el estado, el conductor...).
--   El estado de cualquier día se arma con la última versión hasta ese día.
--
-- registrar_bills_version() guarda un export completo de una vez. La usan la
-- carga diaria y scripts/importar-bills-drive.mjs (los exports antiguos).

create table if not exists public.bills_archivos (
  id bigint generated always as identity primary key,
  archivo text not null,
  drive_id text unique,
  subido timestamptz not null,            -- modifiedTime en Drive o momento de la carga
  dia date not null,                      -- día en Chile
  filas int not null,
  filas_sin_conductor int not null default 0,
  nuevas int not null default 0,
  cambios int not null default 0,
  origen text not null check (origen in ('drive', 'carga')),
  carga_id uuid unique references public.cargas (id),
  creado timestamptz not null default now()
);
alter table public.bills_archivos enable row level security;
create index if not exists bills_archivos_subido on public.bills_archivos (subido);

create table if not exists public.bills_versiones (
  id bigint generated always as identity primary key,
  referencia text not null,
  archivo_id bigint not null references public.bills_archivos (id),
  subido timestamptz not null,
  tipo text,
  estado text,
  vehiculo text,
  conductor text,
  telefono text,
  descripcion text,
  monto numeric not null default 0,
  pagado numeric not null default 0,
  creado_texto text,                      -- "Created At" tal como viene (el reporte lo interpreta)
  unique (referencia, archivo_id)
);
alter table public.bills_versiones enable row level security;
create index if not exists bills_versiones_ref on public.bills_versiones (referencia, subido desc);
create index if not exists bills_versiones_subido on public.bills_versiones (subido);

-- Solo se agregan filas: la historia no se corrige, se vuelve a importar.
drop trigger if exists bills_versiones_sin_cambios on public.bills_versiones;
create trigger bills_versiones_sin_cambios
  before update or delete on public.bills_versiones
  for each row execute function public.rechazar_cambios();

/**
 * Guarda un export de bills: el archivo y las bills que cambiaron respecto de
 * su última versión anterior a este archivo. Si el archivo ya estaba (mismo
 * drive_id o carga_id), no hace nada.
 *
 * p_archivo: { archivo, driveId?, cargaId?, subido, origen }
 * p_filas:   [{ referencia, tipo, estado, vehiculo, conductor, telefono,
 *               descripcion, monto, pagado, creadoTexto }]
 */
create or replace function public.registrar_bills_version(p_archivo jsonb, p_filas jsonb)
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
  perform pg_advisory_xact_lock(hashtext('registrar_bills_version'));

  if exists (select 1 from bills_archivos
             where drive_id = p_archivo->>'driveId' or carga_id = (p_archivo->>'cargaId')::uuid) then
    return jsonb_build_object('ya_registrado', true);
  end if;

  insert into bills_archivos (archivo, drive_id, carga_id, subido, dia, filas, filas_sin_conductor, origen)
  values (p_archivo->>'archivo', p_archivo->>'driveId', (p_archivo->>'cargaId')::uuid, v_subido,
          (v_subido at time zone 'America/Santiago')::date,
          jsonb_array_length(p_filas),
          (select count(*) from jsonb_array_elements(p_filas) x where coalesce(trim(x->>'conductor'), '') = ''),
          p_archivo->>'origen')
  returning id into v_id;

  with x as (
    select distinct on (referencia) *
    from jsonb_to_recordset(p_filas) as t(
      referencia text, tipo text, estado text, vehiculo text, conductor text, telefono text,
      descripcion text, monto numeric, pagado numeric, "creadoTexto" text)
    where coalesce(referencia, '') <> ''
  ), previa as (
    select distinct on (v.referencia) v.*
    from bills_versiones v
    join x on x.referencia = v.referencia
    where v.subido < v_subido
    order by v.referencia, v.subido desc
  ), cambiadas as (
    select x.*, p.referencia is null as nueva
    from x left join previa p on p.referencia = x.referencia
    where p.referencia is null
       or (p.tipo, p.estado, p.vehiculo, p.conductor, p.monto, p.pagado, p.creado_texto, p.descripcion)
          is distinct from (x.tipo, x.estado, x.vehiculo, x.conductor, coalesce(x.monto, 0), coalesce(x.pagado, 0),
                            x."creadoTexto", x.descripcion)
  ), ins as (
    insert into bills_versiones (referencia, archivo_id, subido, tipo, estado, vehiculo, conductor, telefono,
                                 descripcion, monto, pagado, creado_texto)
    select referencia, v_id, v_subido, tipo, estado, vehiculo, conductor, telefono,
           descripcion, coalesce(monto, 0), coalesce(pagado, 0), "creadoTexto"
    from cambiadas
    returning 1
  )
  select count(*) filter (where nueva), count(*) filter (where not nueva) into v_nuevas, v_cambios
  from cambiadas where (select count(*) from ins) >= 0;

  update bills_archivos set nuevas = v_nuevas, cambios = v_cambios where id = v_id;
  return jsonb_build_object('archivo_id', v_id, 'nuevas', v_nuevas, 'cambios', v_cambios);
end $$;

grant select, insert on public.bills_archivos, public.bills_versiones to service_role;
grant update (nuevas, cambios) on public.bills_archivos to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.bills_archivos, public.bills_versiones from anon, authenticated;
revoke all on function public.registrar_bills_version(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_bills_version(jsonb, jsonb) to service_role;
