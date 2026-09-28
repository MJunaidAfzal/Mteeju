-- Teeju: black & gold invoice templates (Noir, Royal, Onyx) and metal tones.
-- The template/accent checks are dropped so future designs need no further database changes.
-- Run once in Supabase → SQL Editor, after 20260928000000_invoice_templates.sql. Safe to run again.

alter table public.invoices
  add column if not exists accent text not null default 'forest';

alter table public.invoices
  drop constraint if exists invoices_template_check;

alter table public.invoices
  drop constraint if exists invoices_accent_check;

-- Keep the values sane without pinning them to a fixed list
alter table public.invoices
  add constraint invoices_template_check check (char_length(template) between 1 and 40);

alter table public.invoices
  add constraint invoices_accent_check check (char_length(accent) between 1 and 40);
