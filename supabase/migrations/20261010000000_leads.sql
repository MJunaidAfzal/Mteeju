-- Teeju: leads imported from CSV and enriched with contact details.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '',
  category text not null default '',
  phone text not null default '',
  website text not null default '',
  address text not null default '',
  city text not null default '',
  country text not null default '',
  rating numeric(3, 2),
  reviews integer,
  -- Google business id / place id, used for enrichment
  business_id text not null default '',
  -- the CSV file this lead came from
  source text not null default '',
  status text not null default 'new'
    check (status in ('new', 'enriched', 'no_contacts', 'contacted', 'replied', 'won', 'lost', 'unsubscribed')),
  emails jsonb not null default '[]'::jsonb check (jsonb_typeof(emails) = 'array'),
  phones jsonb not null default '[]'::jsonb check (jsonb_typeof(phones) = 'array'),
  -- { facebook, instagram, linkedin, twitter, tiktok, youtube }
  socials jsonb not null default '{}'::jsonb check (jsonb_typeof(socials) = 'object'),
  notes text not null default '',
  enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same business imported twice is skipped: by business id, else by name + address
  dedupe_key text generated always as (
    case
      when business_id <> '' then lower(business_id)
      else lower(name) || '|' || lower(address)
    end
  ) stored
);

create unique index if not exists leads_dedupe_idx on public.leads (user_id, dedupe_key);
create index if not exists leads_user_idx on public.leads (user_id, created_at desc);
create index if not exists leads_status_idx on public.leads (user_id, status);

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

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

drop policy if exists "Users manage their own leads" on public.leads;
create policy "Users manage their own leads"
  on public.leads
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.leads to authenticated;
