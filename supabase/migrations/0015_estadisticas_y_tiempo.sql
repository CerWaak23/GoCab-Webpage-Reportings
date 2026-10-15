-- Estadísticas al día y tiempo máximo para el servidor de GoBills.
--
-- Después del TRUNCATE de 0013 la base se quedó sin estadísticas de las tablas
-- de historia y registrar un export de bills pasaba el tiempo máximo (8 s).
-- El servidor de GoBills (service_role) puede esperar hasta 60 s, lo mismo que
-- Vercel le da a una carga; el navegador (anon, authenticated) sigue igual.

analyze public.bills_archivos;
analyze public.bills_versiones;
analyze public.multas_archivos;
analyze public.multas_versiones;

alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';
