-- La tabla usuarios pasa a ser la lista de quién entra al portal interno
-- (antes era un arreglo en src/lib/users.js). rol sigue decidiendo los permisos
-- (gerencia | coordinador | taller | admin); cargo es lo que se muestra.
-- Sin cargo, el portal muestra el rol.

alter table public.usuarios add column if not exists cargo text;

update public.usuarios set cargo = v.cargo
from (values
  ('joy.varela@gocab.io',     'Coordinador de Flota'),
  ('pablogonzalez@gocab.io',  'Coordinador de Flota'),
  ('paula.flores@gocab.io',   'Coordinadora de Flota'),
  ('javiera.silva@gocab.io',  'Coordinadora de Flota'),
  ('artem.tokarev@gocab.io',  'Gerente de Producto'),
  ('andres.cerda@gocab.io',   'Gerente de Operaciones'),
  ('felipe@gocab.io',         'Gerente de Pais')
) as v(email, cargo)
where usuarios.email = v.email and usuarios.cargo is null;

comment on table public.usuarios is
  'Quién entra al portal interno. activo = false lo saca en menos de un minuto, aunque tenga sesión abierta.';
comment on column public.usuarios.rol is
  'Permisos: gerencia y admin ven el Reporte Financiero; taller no ve deudas ni Carga de datos.';
comment on column public.usuarios.cargo is
  'Lo que se muestra en el portal ("Gerente de Operaciones"). Si está vacío se muestra el rol.';
