-- Teeju: storage for images and videos uploaded in the social composer.
-- Run once in Supabase → SQL Editor. Safe to run again.

-- Public, because Facebook and Instagram fetch the file from its URL when a post is published.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', true, 52428800, array['image/*', 'video/*'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Each user writes only inside their own folder: <user id>/<file>
drop policy if exists "Users upload their own social media" on storage.objects;
create policy "Users upload their own social media"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users delete their own social media" on storage.objects;
create policy "Users delete their own social media"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
