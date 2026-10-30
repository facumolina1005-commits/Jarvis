-- Pegá esto en Supabase > SQL Editor > Run.
-- Crea una tabla privada para la copia de tus datos. Sin políticas, solo tu servidor (clave de servicio) puede leerla o escribirla.
create table if not exists public.jarvis_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.jarvis_state enable row level security;
