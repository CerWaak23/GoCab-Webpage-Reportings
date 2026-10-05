-- Teléfono de la asistencia SURA para el botón del portal (R81). Lo puede
-- cambiar un administrador desde Configuración.
insert into public.configuracion (clave, valor)
values ('telefono_asistencia_sura', '"600 411 1000"'::jsonb)
on conflict (clave) do nothing;

-- RUT de GoCab (dueño de los autos), que el conductor necesita al hacer la
-- denuncia en SCH Seguros (R77). Dato de la empresa, no personal.
insert into public.configuracion (clave, valor)
values ('rut_empresa', '"78.164.208-8"'::jsonb)
on conflict (clave) do nothing;
