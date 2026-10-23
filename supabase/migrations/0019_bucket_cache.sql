-- Bucket privado para el caché de los reportes de bills y multas
-- (src/lib/historia/cache.js). Solo admite los archivos comprimidos del caché.
-- Se creó por la API de Storage el 23-10-2026; esto lo deja registrado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cache', 'cache', false, 52428800, array['application/gzip'])
on conflict (id) do nothing;
