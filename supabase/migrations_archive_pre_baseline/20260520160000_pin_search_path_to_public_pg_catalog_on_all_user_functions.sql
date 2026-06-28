-- =====================================================================
-- Pin search_path = public, pg_catalog on every user-defined function
-- in the public schema.
--
-- Resolves all 194 `function_search_path_mutable` lints flagged by the
-- Supabase Security Advisor. The default Postgres function search_path
-- inherits the calling session's setting, which is a documented
-- SQL-injection / schema-shadowing surface — a hostile schema earlier
-- in the user's search_path can shadow `public.<table>` references
-- inside SECURITY DEFINER functions and reroute writes/reads.
--
-- Behavioral impact: zero. Every function in scope already references
-- public tables via either unqualified names (which resolve to public
-- under the new pin exactly as they did under the inherited setting)
-- or fully-qualified names (auth.uid(), extensions.http_get) which
-- are unaffected by search_path.
--
-- Filter (matches the advisor's set exactly, count verified live):
--   - public schema only
--   - plpgsql or sql language (skip extension-owned C functions)
--   - NOT extension-owned via pg_depend.deptype = 'e'
--   - search_path not already pinned via proconfig
--
-- Cross-schema usage audited pre-migration:
--   _current_app_user_id     — auth.uid() (qualified, safe)
--   apply_sql_from_url       — extensions.http_get() (qualified, safe)
--   clone_project_report_template — "auth" hit was a code comment only
-- =====================================================================

DO $migration$
DECLARE
  r record;
  v_altered integer := 0;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language  l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND l.lanname IN ('plpgsql','sql')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid   = p.oid
          AND d.deptype = 'e'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c(setting)
        WHERE c.setting LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_catalog',
      r.schema_name, r.proname, r.args
    );
    v_altered := v_altered + 1;
  END LOOP;

  RAISE NOTICE 'Pinned search_path on % functions', v_altered;
END
$migration$;

-- ── Post-update verification ────────────────────────────────────────
-- Zero functions in scope should remain unpinned after the loop.
DO $verify$
DECLARE
  v_remaining integer;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language  l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND l.lanname IN ('plpgsql','sql')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid   = p.oid
        AND d.deptype = 'e'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c(setting)
      WHERE c.setting LIKE 'search_path=%'
    );

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Expected 0 unpinned functions in public schema after sweep, found %', v_remaining;
  END IF;
END
$verify$;
