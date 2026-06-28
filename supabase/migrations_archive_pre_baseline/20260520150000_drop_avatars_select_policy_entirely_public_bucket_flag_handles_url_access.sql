-- =====================================================================
-- Drop the avatars_authenticated_read SELECT policy entirely.
--
-- The `avatars` bucket has `public = true` set at the bucket level, which
-- routes URL reads through the storage CDN proxy without consulting RLS
-- on storage.objects. So a SELECT policy on storage.objects governs only
-- the `list objects in bucket` API path, not URL fetches. The advisor's
-- preferred shape for public buckets is: no SELECT policy, no listing
-- API access, URL fetches still work via the public-bucket flag.
--
-- After this migration:
--   - Anyone with a valid object URL can still fetch the file (CDN path)
--   - Nobody can list bucket contents via the storage.objects table
--   - INSERT/UPDATE/DELETE remain authenticated-only and scoped to the bucket
-- =====================================================================

DROP POLICY IF EXISTS avatars_authenticated_read ON storage.objects;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='storage' AND tablename='objects'
               AND policyname IN ('avatars_authenticated_read','avatars_public_read')) THEN
    RAISE EXCEPTION 'A SELECT policy still exists on the avatars bucket';
  END IF;
END $$;
