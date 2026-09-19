-- Teeju: saved RapidAPI services and their endpoints.
-- Run once in Supabase → SQL Editor. Safe to run again.

-- APIs (one row per RapidAPI host)
create table if not exists public.api_services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  host text not null check (host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.rapidapi\.com$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, host)
);

-- Endpoints saved under each API
create table if not exists public.api_endpoints (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.api_services (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'New endpoint',
  method text not null default 'GET' check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  path text not null default '/',
  query jsonb not null default '[]'::jsonb check (jsonb_typeof(query) = 'array'),
  body text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists api_services_user_id_idx on public.api_services (user_id);
create index if not exists api_endpoints_service_id_idx on public.api_endpoints (service_id);
create index if not exists api_endpoints_user_id_idx on public.api_endpoints (user_id);

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists api_services_set_updated_at on public.api_services;
create trigger api_services_set_updated_at
  before update on public.api_services
  for each row execute function public.set_updated_at();

drop trigger if exists api_endpoints_set_updated_at on public.api_endpoints;
create trigger api_endpoints_set_updated_at
  before update on public.api_endpoints
  for each row execute function public.set_updated_at();

-- Row Level Security: every user sees and changes only their own rows
alter table public.api_services enable row level security;
alter table public.api_endpoints enable row level security;

drop policy if exists "Users manage their own API services" on public.api_services;
create policy "Users manage their own API services"
  on public.api_services
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own API endpoints" on public.api_endpoints;
create policy "Users manage their own API endpoints"
  on public.api_endpoints
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.api_services s
      where s.id = service_id and s.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.api_services, public.api_endpoints to authenticated;
