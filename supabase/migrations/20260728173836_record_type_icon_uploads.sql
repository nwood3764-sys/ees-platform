-- ---------------------------------------------------------------------------
-- Custom record type icons — storage bucket
-- ---------------------------------------------------------------------------
-- Lets an admin upload a custom SVG/PNG icon for a record type, in addition to
-- picking from the built-in catalog. Uploaded assets live in a dedicated
-- PUBLIC bucket so the badge can render them by URL (CSS mask for the
-- monochrome/match-badge mode, <img> for the keep-original-colors mode) with
-- no signed-URL expiry to manage — icons are non-sensitive UI chrome, exactly
-- like the existing public `avatars` bucket.
--
-- The record type row stores the reference in picklist_values.picklist_icon as
-- `upload:mono:<publicUrl>` or `upload:color:<publicUrl>`; a built-in icon
-- stays a bare catalog key. No schema change to picklist_values is needed.
--
-- Security: rendering is XSS-safe because the client never inlines the SVG —
-- CSS mask and <img src> both refuse to execute scripts embedded in an SVG.
-- Writes mirror the `avatars` policy model (authenticated role; the record-type
-- editor is already admin-gated in the UI). Public read comes from the bucket
-- being public.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'record-type-icons',
  'record-type-icons',
  true,
  524288, -- 512 KB — icons are tiny; this rejects oversized art up front
  array['image/svg+xml', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Writes for authenticated users, scoped to this bucket only (mirrors avatars).
drop policy if exists record_type_icons_authenticated_insert on storage.objects;
create policy record_type_icons_authenticated_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'record-type-icons');

drop policy if exists record_type_icons_authenticated_update on storage.objects;
create policy record_type_icons_authenticated_update
  on storage.objects for update to authenticated
  using (bucket_id = 'record-type-icons')
  with check (bucket_id = 'record-type-icons');

drop policy if exists record_type_icons_authenticated_delete on storage.objects;
create policy record_type_icons_authenticated_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'record-type-icons');

-- (Public SELECT is provided by the bucket's public flag; no extra policy needed.)
