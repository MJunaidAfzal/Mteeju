-- Teeju: social media manager — connected accounts and posts.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null,
  label text not null default '',
  handle text not null default '',
  -- Telegram: { botToken, chatId } · Discord: { webhookUrl } · Webhook: { url }
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null default '',
  -- [{ url, type }]
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  -- ids from social_accounts
  account_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(account_ids) = 'array'),
  tags text not null default '',
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'partial', 'failed')),
  -- [{ accountId, ok, error, link }]
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_accounts_user_idx on public.social_accounts (user_id);
create index if not exists social_posts_user_idx on public.social_posts (user_id, scheduled_at desc);
create index if not exists social_posts_due_idx on public.social_posts (status, scheduled_at);

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

drop trigger if exists social_accounts_set_updated_at on public.social_accounts;
create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists social_posts_set_updated_at on public.social_posts;
create trigger social_posts_set_updated_at
  before update on public.social_posts
  for each row execute function public.set_updated_at();

alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;

drop policy if exists "Users manage their own social accounts" on public.social_accounts;
create policy "Users manage their own social accounts"
  on public.social_accounts
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own social posts" on public.social_posts;
create policy "Users manage their own social posts"
  on public.social_posts
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.social_accounts, public.social_posts to authenticated;
