-- Teeju: invoices and the saved business details used to prefill them.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  number text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  template text not null default 'classic' check (template in ('classic', 'modern', 'minimal')),
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'USD',
  -- { name, email, phone, address, website, taxId, logo }
  business jsonb not null default '{}'::jsonb,
  -- { name, email, phone, address }
  client jsonb not null default '{}'::jsonb,
  -- [{ id, description, qty, rate }]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  tax_rate numeric(6, 3) not null default 0,
  discount numeric(14, 2) not null default 0,
  discount_type text not null default 'amount' check (discount_type in ('amount', 'percent')),
  shipping numeric(14, 2) not null default 0,
  notes text not null default '',
  terms text not null default '',
  payment_details text not null default '',
  signature text not null default '',
  signature_name text not null default '',
  subtotal numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, number)
);

-- One row per user: business details, logo, signature and defaults for new invoices
create table if not exists public.invoice_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_user_id_idx on public.invoices (user_id, issue_date desc);

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

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

drop trigger if exists invoice_settings_set_updated_at on public.invoice_settings;
create trigger invoice_settings_set_updated_at
  before update on public.invoice_settings
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;
alter table public.invoice_settings enable row level security;

drop policy if exists "Users manage their own invoices" on public.invoices;
create policy "Users manage their own invoices"
  on public.invoices
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own invoice settings" on public.invoice_settings;
create policy "Users manage their own invoice settings"
  on public.invoice_settings
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.invoices, public.invoice_settings to authenticated;
