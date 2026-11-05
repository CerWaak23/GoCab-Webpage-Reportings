-- Despedidos: la cuenta bancaria a la que se le devuelve la garantía (nov-2026).
-- La ingresa el coordinador; la cuenta completa solo la ve gerencia, que es
-- quien transfiere (al resto la API se la manda enmascarada).
alter table public.despedidos_gestion add column if not exists cuenta jsonb;   -- { titular, rut, banco, tipo, numero, email }
alter table public.despedidos_gestion add column if not exists cuenta_por citext;
alter table public.despedidos_gestion add column if not exists cuenta_en timestamptz;
