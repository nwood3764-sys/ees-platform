-- =====================================================================
-- Tighten three RLS surfaces flagged by Supabase Security Advisor:
--   1. public.bulk_import_runs        — replace WITH CHECK true policies
--                                       with admin-only INSERT/UPDATE/DELETE
--   2. public.object_lifecycle_config — same treatment
--   3. storage.objects (avatars)      — remove broad anon-listable SELECT
--                                       policy; replace with authenticated-
--                                       only SELECT scoped to the bucket
--
-- None of these tables today carry customer data, but each had a
-- USING/WITH CHECK clause of literal `true` for the authenticated role,
-- bypassing RLS for any logged-in user. The new policies follow the
-- universal pattern in this schema: SELECT open to authenticated for
-- introspection, write paths admin-only via the is_admin() resolver.
--
-- The `bulk_import_runs` write path is exercised exclusively through the
-- `import_property_hierarchy` SECURITY DEFINER RPC, which bypasses RLS by
-- definition and is unaffected by this tightening. The `BulkPropertyImportPane`
-- UI calls only the RPC, never the table directly. Verified via grep.
--
-- `object_lifecycle_config` has zero frontend reads and zero references
-- in any function; the table is currently inert and contains one
-- already-soft-deleted smoke-test row. Verified via pg_proc.prosrc scan
-- and src/ grep.
--
-- The avatars bucket currently contains 0 files. The new SELECT policy
-- still allows authenticated users to read objects in the bucket — what
-- changes is that anonymous listing is no longer possible.
-- =====================================================================

-- ── 1. bulk_import_runs ──────────────────────────────────────────────
DROP POLICY IF EXISTS bir_insert ON public.bulk_import_runs;
DROP POLICY IF EXISTS bir_update ON public.bulk_import_runs;

-- SELECT policy already exists (bir_select USING true). Leaving it open
-- to authenticated for introspection — the table only contains import
-- audit metadata (run id, started_at, counts), no customer data.

CREATE POLICY bir_insert_admin
  ON public.bulk_import_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY bir_update_admin
  ON public.bulk_import_runs
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY bir_delete_admin
  ON public.bulk_import_runs
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ── 2. object_lifecycle_config ───────────────────────────────────────
DROP POLICY IF EXISTS authenticated_insert ON public.object_lifecycle_config;
DROP POLICY IF EXISTS authenticated_update ON public.object_lifecycle_config;
DROP POLICY IF EXISTS authenticated_delete ON public.object_lifecycle_config;

-- SELECT policy already exists (authenticated_read USING true). Leaving
-- it open — this table is config metadata, no PII.

CREATE POLICY olc_insert_admin
  ON public.object_lifecycle_config
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY olc_update_admin
  ON public.object_lifecycle_config
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY olc_delete_admin
  ON public.object_lifecycle_config
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ── 3. storage.objects — avatars bucket ──────────────────────────────
-- Replace the public-role SELECT with an authenticated-only equivalent.
-- Note: storage.objects RLS doesn't gate URL-based reads through the
-- public bucket CDN — anon URL fetches go through the storage proxy and
-- are governed by bucket-level `public` flag, not RLS. What this policy
-- gates is `storage.objects` table reads (i.e. listing). Removing the
-- public-role policy stops anonymous listing without affecting authenticated
-- access or signed-URL reads.

DROP POLICY IF EXISTS avatars_public_read ON storage.objects;

CREATE POLICY avatars_authenticated_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');

-- ── Post-update verification ─────────────────────────────────────────
DO $$
DECLARE
  bir_always_true integer;
  olc_always_true integer;
  avatars_public_read_exists integer;
BEGIN
  -- Count remaining "always true" policies on the two flagged tables
  SELECT COUNT(*) INTO bir_always_true
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'bulk_import_runs'
    AND ( (qual       = 'true' AND cmd IN ('SELECT','UPDATE','DELETE'))
       OR (with_check = 'true' AND cmd IN ('INSERT','UPDATE')) )
    AND policyname NOT IN ('bir_select');  -- SELECT-open is intentional

  SELECT COUNT(*) INTO olc_always_true
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'object_lifecycle_config'
    AND ( (qual       = 'true' AND cmd IN ('SELECT','UPDATE','DELETE'))
       OR (with_check = 'true' AND cmd IN ('INSERT','UPDATE')) )
    AND policyname NOT IN ('authenticated_read');

  SELECT COUNT(*) INTO avatars_public_read_exists
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'avatars_public_read';

  IF bir_always_true > 0 THEN
    RAISE EXCEPTION 'bulk_import_runs still has % "always true" write policies', bir_always_true;
  END IF;
  IF olc_always_true > 0 THEN
    RAISE EXCEPTION 'object_lifecycle_config still has % "always true" write policies', olc_always_true;
  END IF;
  IF avatars_public_read_exists > 0 THEN
    RAISE EXCEPTION 'avatars_public_read policy was not dropped';
  END IF;
END $$;
