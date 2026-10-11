-- Teeju: automatic WhatsApp sending through the official Meta Cloud API.
-- Run once in Supabase → SQL Editor. Safe to run again.
-- Campaigns without these settings keep working exactly as before: by hand, one click each.

alter table public.campaigns
  -- when true the whatsapp-send function delivers this campaign on its own
  add column if not exists auto_send boolean not null default false,
  -- the template approved in the Meta dashboard, e.g. "intro_offer"
  add column if not exists template_name text not null default '',
  add column if not exists template_lang text not null default 'en_US',
  -- what fills {{1}}, {{2}} … in that template, in order
  add column if not exists template_params text not null default '{{name}}';
