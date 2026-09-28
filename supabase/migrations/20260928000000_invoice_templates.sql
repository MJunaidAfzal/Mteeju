-- Teeju: extra invoice templates (Luxe, Bold, Compact) and colour variants.
-- Run once in Supabase → SQL Editor, after 20260926000000_invoices.sql. Safe to run again.

alter table public.invoices
  add column if not exists accent text not null default 'forest';

alter table public.invoices
  drop constraint if exists invoices_template_check;

alter table public.invoices
  add constraint invoices_template_check
  check (template in ('classic', 'modern', 'minimal', 'luxe', 'bold', 'compact'));

alter table public.invoices
  drop constraint if exists invoices_accent_check;

alter table public.invoices
  add constraint invoices_accent_check
  check (accent in ('forest', 'gold', 'maroon', 'navy', 'charcoal', 'plum'));
