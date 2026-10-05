-- Teléfono de la asistencia SURA para el botón del portal (R81). Lo puede
-- cambiar un administrador desde Configuración.
insert into public.configuracion (clave, valor)
values ('telefono_asistencia_sura', '"600 411 1000"'::jsonb)
on conflict (clave) do nothing;
