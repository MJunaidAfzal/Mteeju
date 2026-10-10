-- Teeju: outreach campaigns — the steps they send and the queue of messages.
-- Run once in Supabase → SQL Editor. Safe to run again.

-- A campaign picks a set of leads and walks them through its steps over a number of days.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'running', 'paused', 'done')),
  -- which leads take part: '' means every file / any status
  source text not null default '',
  -- how the sender signs off
  from_name text not null default '',
  signature text not null default '',
  -- pacing
  daily_cap integer not null default 25 check (daily_cap between 1 and 500),
  send_from integer not null default 10 check (send_from between 0 and 23),
  send_to integer not null default 18 check (send_to between 1 and 24),
  timezone text not null default 'Asia/Dubai',
  started_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One message in the sequence: "on day 2, send this WhatsApp text".
create table if not exists public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  day integer not null default 1 check (day between 1 and 90),
  channel text not null default 'email' check (channel in ('email', 'whatsapp')),
  subject text not null default '',
  body text not null default '',
  -- let the AI rewrite the opening line for each business
  personalise boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every message the campaign owes a lead. Email rows are sent by the runner,
-- WhatsApp rows wait in the portal for a one-click send.
create table if not exists public.outreach_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  step_id uuid not null references public.campaign_steps (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  -- email address or phone number this message goes to
  recipient text not null default '',
  subject text not null default '',
  body text not null default '',
  scheduled_for timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped', 'cancelled')),
  sent_at timestamptz,
  error text not null default '',
  created_at timestamptz not null default now()
);

-- A lead never gets the same step twice.
create unique index if not exists outreach_queue_once_idx
  on public.outreach_queue (step_id, lead_id);
create index if not exists outreach_queue_due_idx
  on public.outreach_queue (user_id, status, scheduled_for);
create index if not exists outreach_queue_campaign_idx
  on public.outreach_queue (campaign_id, status);
create index if not exists campaign_steps_campaign_idx
  on public.campaign_steps (campaign_id, day);
create index if not exists campaigns_user_idx
  on public.campaigns (user_id, created_at desc);

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

alter table public.campaigns enable row level security;
alter table public.campaign_steps enable row level security;
alter table public.outreach_queue enable row level security;

drop policy if exists "Users manage their own campaigns" on public.campaigns;
create policy "Users manage their own campaigns"
  on public.campaigns
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own campaign steps" on public.campaign_steps;
create policy "Users manage their own campaign steps"
  on public.campaign_steps
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own queue" on public.outreach_queue;
create policy "Users manage their own queue"
  on public.outreach_queue
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.campaign_steps to authenticated;
grant select, insert, update, delete on public.outreach_queue to authenticated;
