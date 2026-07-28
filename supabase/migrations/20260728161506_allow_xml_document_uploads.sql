-- Allow XML document uploads on internal document buckets.
--
-- Context: uploadDocument() in src/data/storageService.js routes an opportunity's
-- (and most records') attachments to the `property-documents` bucket, and
-- incentive_application attachments to `program-applications`. Both buckets carry
-- an allowed_mime_types allowlist that omitted XML, so Supabase Storage rejected
-- every .xml upload with "mime type text/xml is not supported" before the
-- documents row was ever written. XML files are attached to every opportunity, so
-- this is a required file type.
--
-- Browsers report a .xml file as either text/xml or application/xml depending on
-- OS/browser, so both are added. Idempotent: union-distinct against the existing
-- list, so re-running is a no-op and no other allowed types are disturbed.

update storage.buckets
set allowed_mime_types = (
  select array(select distinct unnest(allowed_mime_types || array['text/xml', 'application/xml']))
)
where id in ('property-documents', 'program-applications')
  and allowed_mime_types is not null;
