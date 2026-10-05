-- Actas de entrega y recepción (U14).
--
-- * Checklist inicial (versión 1), la del prototipo aprobado. Se edita desde
--   Configuración creando una versión nueva; cada acta guarda la suya (R10).
-- * Un acta firmada no se puede cambiar ni borrar, tampoco con la clave
--   secreta (KTD15): solo se le agrega el PDF una vez. Las correcciones van
--   como notas (R13). Lo mismo para sus archivos.

insert into public.checklists (version, items, creada_por)
values (1, '[
  {"grupo": "Documentos en el auto", "items": ["Padrón", "Permiso de circulación", "SOAP", "Póliza de seguro"]},
  {"grupo": "Equipamiento", "items": ["Cable de carga", "Triángulo", "Extintor", "Botiquín", "Chaleco reflectante", "Rueda de repuesto o kit", "Gata y llave de rueda", "TAG", "Llaves / tarjeta", "Alfombras"]},
  {"grupo": "Estado general", "items": ["Limpieza interior", "Limpieza exterior", "Sin olor a cigarro"]}
]'::jsonb, 'sistema')
on conflict (version) do nothing;

create or replace function public.proteger_acta_firmada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.firmado then
      raise exception 'Un acta firmada no se puede borrar';
    end if;
    return old;
  end if;
  if old.firmado then
    -- Lo único permitido: adjuntar el PDF (una vez) y marcar la sincronización.
    if (to_jsonb(new) - 'pdf_ruta' - 'pdf_hash' - 'sincronizado') is distinct from
       (to_jsonb(old) - 'pdf_ruta' - 'pdf_hash' - 'sincronizado')
       or (old.pdf_ruta is not null and new.pdf_ruta is distinct from old.pdf_ruta)
       or (old.pdf_hash is not null and new.pdf_hash is distinct from old.pdf_hash) then
      raise exception 'Un acta firmada no se puede modificar; agrega una nota';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists proteger_acta_firmada on public.eventos;
create trigger proteger_acta_firmada
  before update or delete on public.eventos
  for each row execute function public.proteger_acta_firmada();

create or replace function public.proteger_archivos_de_acta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from eventos e where e.id = old.evento_id and e.firmado) then
    raise exception 'Los archivos de un acta firmada no se pueden cambiar ni borrar';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists proteger_archivos_de_acta on public.archivos;
create trigger proteger_archivos_de_acta
  before update or delete on public.archivos
  for each row execute function public.proteger_archivos_de_acta();

-- Una sola acta por envío del teléfono (reintentos sin duplicar).
create unique index if not exists eventos_uid on public.eventos ((detalle->>'uid')) where detalle ? 'uid';

revoke all on function public.proteger_acta_firmada() from public, anon, authenticated;
revoke all on function public.proteger_archivos_de_acta() from public, anon, authenticated;
