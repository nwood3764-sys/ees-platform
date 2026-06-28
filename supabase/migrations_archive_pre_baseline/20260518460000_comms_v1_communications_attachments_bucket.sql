-- Communications Module v1, Slice 5
-- Creates the storage bucket for email attachments.
--
-- Spec storage layout: communications/{conversation_id}/{message_id}/{filename}
-- All entries linked from public.message_attachments. Authenticated users
-- (i.e. internal staff with a LEAP session) can read; uploads happen via the
-- compose flow which writes service-role from the edge function.
--
-- Bucket is non-public — every download goes through a signed URL minted by
-- the JS client at view time. RLS on storage.objects limits authenticated
-- SELECT/INSERT to this bucket name. Public links are NEVER issued for these
-- attachments.

INSERT INTO storage.buckets (id, name, public)
VALUES ('communications-attachments', 'communications-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies — authenticated staff only, scoped to the bucket
DROP POLICY IF EXISTS communications_attachments_authenticated_select ON storage.objects;
CREATE POLICY communications_attachments_authenticated_select
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'communications-attachments');

DROP POLICY IF EXISTS communications_attachments_authenticated_insert ON storage.objects;
CREATE POLICY communications_attachments_authenticated_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'communications-attachments');

DROP POLICY IF EXISTS communications_attachments_authenticated_update ON storage.objects;
CREATE POLICY communications_attachments_authenticated_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'communications-attachments')
  WITH CHECK (bucket_id = 'communications-attachments');

DROP POLICY IF EXISTS communications_attachments_authenticated_delete ON storage.objects;
CREATE POLICY communications_attachments_authenticated_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'communications-attachments');
