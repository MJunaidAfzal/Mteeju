-- Teeju: remember Lead Finder choices (country, city, niche, lead count, filters) per endpoint.
-- Run once in Supabase → SQL Editor, after 20260919000000_api_services.sql. Safe to run again.

alter table public.api_endpoints
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.api_endpoints
  drop constraint if exists api_endpoints_settings_is_object;

alter table public.api_endpoints
  add constraint api_endpoints_settings_is_object check (jsonb_typeof(settings) = 'object');
