-- ─────────────────────────────────────────────────────────────────────────────
-- Short, revocable links for files referenced from a generated report.
--
-- A report is filed with a program and read by people outside EES. Today each
-- photo in it carries a Supabase signed URL: ~500 characters of JWT on a
-- hostname that reads as random letters. Gmail shows that raw string on its
-- redirect interstitial and Acrobat names the host in a security prompt, so a
-- reviewer is asked to trust something that looks exactly like phishing
-- (Nicholas, 2026-08-27: "This is really scary").
--
-- This replaces that with leap.energyefficiencyservices.org/f/<32 hex chars>.
--
-- ── Why this is SAFER than what it replaces, not riskier ────────────────────
--
-- The thing being handed out today is already an unauthenticated capability:
-- anyone holding that signed URL can fetch that file for a year, and there is
-- no way to withdraw it. It is currently being copied into Google's redirect
-- logs and into every forwarded email. This design keeps the same capability
-- model and adds the controls the signed URL cannot have:
--
--   ONE FILE            a token resolves to exactly one stored (bucket, path).
--                       It is not an identifier the holder can alter, and the
--                       server NEVER takes a path from the request — so there
--                       is nothing to traverse, enumerate or substitute.
--   READ ONLY           the serving function performs a storage download and
--                       nothing else. It accepts no body, no query, no verbs
--                       beyond GET. It cannot write, delete or reach any table
--                       other than this one.
--   NOT A DB CREDENTIAL the token grants no database access whatsoever. It is
--                       not a JWT, carries no role, and is meaningless outside
--                       the one lookup below.
--   UNGUESSABLE         128 bits from gen_random_uuid. Not sequential, not
--                       derived from the record, so holding one link tells you
--                       nothing about any other.
--   REVOCABLE           soft-delete the row and the link is dead immediately.
--                       A signed URL cannot be withdrawn at all.
--   EXPIRING            stored, so the life of every outstanding link can be
--                       shortened later by an UPDATE.
--   AUDITED             every fetch stamps last-accessed and increments a
--                       count, so unexpected use is visible.
--
-- Minting requires an authenticated LEAP user, and the bucket is checked
-- against an allowlist so a caller cannot mint a link to a bucket the reports
-- have no business exposing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.seq_report_file_links;

CREATE TABLE IF NOT EXISTS public.report_file_links (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfl_record_number       text NOT NULL,
  -- The capability. Unique, unguessable, and the ONLY thing the reader holds.
  rfl_token               text NOT NULL,
  rfl_storage_bucket      text NOT NULL,
  rfl_storage_path        text NOT NULL,
  -- What the file should be called if the reader saves it.
  rfl_display_name        text,
  rfl_expires_at          timestamptz NOT NULL,
  -- What this link was minted for, so a row is traceable back to its record.
  rfl_photo_id            uuid REFERENCES public.photos(id),
  rfl_document_id         uuid REFERENCES public.documents(id),
  rfl_work_order_id       uuid REFERENCES public.work_orders(id),
  -- Usage, for spotting a link being used in ways nobody expected.
  rfl_last_accessed_at    timestamptz,
  rfl_access_count        integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES public.users(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES public.users(id),
  is_deleted              boolean NOT NULL DEFAULT false,
  deleted_at              timestamptz,
  deleted_by              uuid REFERENCES public.users(id)
);

-- The token is the lookup key on every fetch and must be unique platform-wide.
CREATE UNIQUE INDEX IF NOT EXISTS report_file_links_token_idx
  ON public.report_file_links (rfl_token);

-- Reusing a live link for the same file keeps a regenerated report from
-- minting a fresh row per photo every time it is built.
CREATE INDEX IF NOT EXISTS report_file_links_target_idx
  ON public.report_file_links (rfl_storage_bucket, rfl_storage_path)
  WHERE is_deleted IS NOT TRUE;

-- search_path pinned: the advisor flags a role-mutable search_path on any
-- function, and this one runs on every insert.
CREATE OR REPLACE FUNCTION public.set_rfl_record_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.rfl_record_number IS NULL OR NEW.rfl_record_number = '' THEN
    NEW.rfl_record_number := public.generate_record_number('RFL-', 'seq_report_file_links');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rfl_record_number ON public.report_file_links;
CREATE TRIGGER trg_rfl_record_number
  BEFORE INSERT ON public.report_file_links
  FOR EACH ROW EXECUTE FUNCTION public.set_rfl_record_number();

-- ── Row level security ──────────────────────────────────────────────────────
-- Internal staff may READ these rows (to audit or revoke a link). Nobody
-- writes them directly: minting goes through the definer function below, which
-- is the only place a token is created. anon has no access of any kind.
ALTER TABLE public.report_file_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rfl_select ON public.report_file_links;
CREATE POLICY rfl_select ON public.report_file_links
  FOR SELECT TO authenticated
  USING ( ( SELECT public.current_app_user_id() ) IS NOT NULL );

REVOKE ALL ON public.report_file_links FROM anon;
GRANT SELECT ON public.report_file_links TO authenticated;

-- ── Minting ─────────────────────────────────────────────────────────────────
-- Requires an authenticated LEAP user. The bucket is checked against an
-- allowlist so a report can never mint a link into a bucket it has no business
-- exposing (templates, signatures, avatars and the rest stay unreachable).
CREATE OR REPLACE FUNCTION public.mint_report_file_link(
  p_bucket        text,
  p_path          text,
  p_display_name  text DEFAULT NULL,
  p_ttl_seconds   integer DEFAULT 31536000,
  p_photo_id      uuid DEFAULT NULL,
  p_document_id   uuid DEFAULT NULL,
  p_work_order_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_user    uuid := public.current_app_user_id();
  v_token   text;
  v_expires timestamptz := now() + make_interval(secs => greatest(60, least(p_ttl_seconds, 31536000)));
  v_existing public.report_file_links%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_bucket IS NULL OR p_path IS NULL OR p_path = '' THEN
    RAISE EXCEPTION 'bucket and path are required';
  END IF;
  -- Only the buckets a generated report legitimately references.
  IF p_bucket NOT IN ('work-evidence', 'property-documents', 'program-applications') THEN
    RAISE EXCEPTION 'bucket not permitted for report links: %', p_bucket;
  END IF;

  -- Reuse a live link for the same file rather than accumulating a row per
  -- regeneration. Refreshes the name and extends the life.
  SELECT * INTO v_existing
  FROM public.report_file_links
  WHERE rfl_storage_bucket = p_bucket
    AND rfl_storage_path = p_path
    AND is_deleted IS NOT TRUE
    AND rfl_expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.report_file_links
       SET rfl_display_name = COALESCE(p_display_name, rfl_display_name),
           rfl_expires_at   = GREATEST(rfl_expires_at, v_expires),
           updated_at       = now(),
           updated_by       = v_user
     WHERE id = v_existing.id;
    RETURN v_existing.rfl_token;
  END IF;

  -- 128 bits as 32 hex characters. Deliberately gen_random_uuid() and not
  -- pgcrypto's gen_random_bytes: pgcrypto is installed in the `extensions`
  -- schema, which is NOT on this function's locked-down search_path, so calling
  -- it here fails at runtime. gen_random_uuid is core Postgres and always
  -- resolvable. Guessing one is hopeless either way, and the whole link still
  -- fits on a single readable line.
  v_token := replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.report_file_links (
    rfl_record_number, rfl_token, rfl_storage_bucket, rfl_storage_path,
    rfl_display_name, rfl_expires_at, rfl_photo_id, rfl_document_id,
    rfl_work_order_id, created_by, updated_by
  ) VALUES (
    '', v_token, p_bucket, p_path,
    p_display_name, v_expires, p_photo_id, p_document_id,
    p_work_order_id, v_user, v_user
  );

  RETURN v_token;
END $$;

REVOKE ALL ON FUNCTION public.mint_report_file_link(text, text, text, integer, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_report_file_link(text, text, text, integer, uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mint_report_file_link(text, text, text, integer, uuid, uuid, uuid) TO authenticated;

-- ── Revoking ────────────────────────────────────────────────────────────────
-- Kills a link immediately. There is no equivalent for a signed URL.
CREATE OR REPLACE FUNCTION public.revoke_report_file_link(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_user uuid := public.current_app_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.report_file_links
     SET is_deleted = true, deleted_at = now(), deleted_by = v_user
   WHERE rfl_token = p_token AND is_deleted IS NOT TRUE;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.revoke_report_file_link(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_report_file_link(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_report_file_link(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
