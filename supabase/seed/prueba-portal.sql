-- Conductora de prueba del portal: "Joy Varela (prueba)" con el auto ficticio
-- FAKECAR y un RUT ficticio. No es un dato personal real.
--   Entrar en /conductores con: patente FAKECAR · RUT 11.111.111-1
-- Queda como provisional y la asignación con origen 'provisional'. Una carga
-- de vehículos de Fleet le quita FAKECAR (Fleet no le asigna conductor);
-- volver a correr este archivo la repone.
with c as (
  insert into public.conductores (rut, rut_valido, nombre, clave_nombre, patentes_fleet, provisional)
  values ('11.111.111-1', true, 'Joy Varela (prueba)', 'JOY VARELA PRUEBA', '{FAKECAR}', true)
  on conflict (rut) do update set nombre = excluded.nombre
  returning id
)
insert into public.asignaciones (patente, conductor_id, desde, origen)
select 'FAKECAR', c.id, current_date, 'provisional' from c
where not exists (select 1 from public.asignaciones a where a.patente = 'FAKECAR' and a.hasta is null);

-- Para borrar la prueba (fotos en Storage aparte):
-- delete from public.archivos where conductor_id = (select id from public.conductores where rut = '11.111.111-1');
-- delete from public.eventos where conductor_id = (select id from public.conductores where rut = '11.111.111-1');
-- delete from public.asignaciones where conductor_id = (select id from public.conductores where rut = '11.111.111-1');
-- delete from public.conductores where rut = '11.111.111-1';
