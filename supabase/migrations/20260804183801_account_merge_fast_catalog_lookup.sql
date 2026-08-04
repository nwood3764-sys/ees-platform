-- =============================================================================
-- Fix: Account Merge times out with "canceling statement due to statement timeout"
--
-- Root cause: preview_account_merge() and merge_accounts() discover the child FK
-- columns to reparent by joining three information_schema views
-- (table_constraints x key_column_usage x constraint_column_usage). On this
-- database that join alone takes ~22.5s to return its 30 rows —
-- constraint_column_usage is pathologically slow here — which blows straight past
-- the authenticated role's 8s statement_timeout before any row is touched. (The
-- statement_timeout cannot be raised from inside the function: the timer is armed
-- from the session value at statement start, so a function-local SET has no effect
-- on the running RPC — verified empirically.)
--
-- Fix: replace the information_schema join with the equivalent direct pg_catalog
-- lookup (pg_constraint / pg_attribute), which returns the SAME 30 single-column
-- FK columns in ~7ms. Every account FK is single-column (verified: 0 composite
-- FKs reference accounts), so conkey[1]/confkey[1] is exact. Function bodies are
-- otherwise byte-for-byte unchanged. After this, the full merge (catalog lookup +
-- ~50 property reparents with their trigger cascades) completes in ~1s.
--
-- Also adds the missing index on properties.property_management_company_id (21.5k
-- rows, previously unindexed) so the two property reparents — and the preview
-- count — do index scans instead of seq scans, keeping the merge fast as the
-- table grows.
-- =============================================================================

-- ── Missing FK index (large table; the only unindexed FK on a big table) ─────
CREATE INDEX IF NOT EXISTS idx_properties_management_company_id
  ON public.properties (property_management_company_id);

-- ── Preview: per-table child counts that would move (read-only) ──────────────
CREATE OR REPLACE FUNCTION public.preview_account_merge(p_loser uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_catalog'
AS $function$
DECLARE rec record; n bigint; counts jsonb := '{}'::jsonb;
BEGIN
  IF current_app_user_id() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  FOR rec IN
    SELECT c.relname AS tbl, att.attname AS col
    FROM pg_constraint con
    JOIN pg_class c        ON c.oid = con.conrelid
    JOIN pg_namespace ns   ON ns.oid = c.relnamespace
    JOIN pg_attribute att  ON att.attrelid = con.conrelid  AND att.attnum = con.conkey[1]
    JOIN pg_attribute ref  ON ref.attrelid = con.confrelid AND ref.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND con.confrelid = 'public.accounts'::regclass
      AND ref.attname = 'id'
      AND c.relname <> 'account_merge_log'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', rec.tbl, rec.col) INTO n USING p_loser;
    IF n > 0 THEN counts := counts || jsonb_build_object(rec.tbl || '.' || rec.col, n); END IF;
  END LOOP;
  RETURN counts;
END;
$function$;

-- ── Merge ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_accounts(p_master uuid, p_loser uuid, p_field_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_catalog'
AS $function$
DECLARE
  rec record; n bigint; counts jsonb := '{}'::jsonb;
  k text; v jsonb; coltype text;
  master_name text; loser_name text;
BEGIN
  IF NOT app_user_can('accounts','delete') THEN
    RAISE EXCEPTION 'You do not have permission to merge accounts.';
  END IF;
  IF p_master IS NULL OR p_loser IS NULL OR p_master = p_loser THEN
    RAISE EXCEPTION 'Pick two different accounts to merge.';
  END IF;
  SELECT account_name INTO master_name FROM accounts WHERE id = p_master AND account_is_deleted IS NOT TRUE;
  IF master_name IS NULL THEN RAISE EXCEPTION 'Master account not found.'; END IF;
  SELECT account_name INTO loser_name FROM accounts WHERE id = p_loser AND account_is_deleted IS NOT TRUE;
  IF loser_name IS NULL THEN RAISE EXCEPTION 'The account to merge was not found.'; END IF;

  -- 1. Apply chosen surviving field values to the master (type-safe per column)
  FOR k, v IN SELECT key, value FROM jsonb_each(p_field_overrides) LOOP
    IF k IN ('id','account_is_deleted','created_at','created_by') THEN CONTINUE; END IF;
    SELECT data_type INTO coltype FROM information_schema.columns
      WHERE table_schema='public' AND table_name='accounts' AND column_name = k;
    IF coltype IS NULL THEN CONTINUE; END IF;
    IF coltype NOT IN ('text','character varying','uuid','numeric','integer','bigint','smallint','boolean','date','double precision','real') THEN CONTINUE; END IF;
    IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
      EXECUTE format('UPDATE accounts SET %I = NULL WHERE id = $1', k) USING p_master;
    ELSE
      EXECUTE format('UPDATE accounts SET %I = ($1)::text::%s WHERE id = $2', k, coltype) USING (v #>> '{}'), p_master;
    END IF;
  END LOOP;

  -- 2. Reparent every child FK pointing at accounts.id (discovered live via
  --    pg_catalog — fast; the information_schema equivalent took ~22.5s here and
  --    timed the whole RPC out).
  FOR rec IN
    SELECT c.relname AS tbl, att.attname AS col
    FROM pg_constraint con
    JOIN pg_class c        ON c.oid = con.conrelid
    JOIN pg_namespace ns   ON ns.oid = c.relnamespace
    JOIN pg_attribute att  ON att.attrelid = con.conrelid  AND att.attnum = con.conkey[1]
    JOIN pg_attribute ref  ON ref.attrelid = con.confrelid AND ref.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND con.confrelid = 'public.accounts'::regclass
      AND ref.attname = 'id'
      AND c.relname <> 'account_merge_log'
  LOOP
    IF rec.tbl = 'accounts' THEN
      -- self-reference (parent_account_id): repoint but never self-parent the master
      EXECUTE format('UPDATE accounts SET %I = $1 WHERE %I = $2 AND id <> $1', rec.col, rec.col) USING p_master, p_loser;
    ELSE
      EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', rec.tbl, rec.col, rec.col) USING p_master, p_loser;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN counts := counts || jsonb_build_object(rec.tbl || '.' || rec.col, n); END IF;
  END LOOP;

  -- 3. Soft-delete the loser
  UPDATE accounts SET account_is_deleted = true WHERE id = p_loser;

  -- 4. Audit log
  INSERT INTO account_merge_log (aml_master_account_id, aml_merged_account_id, aml_field_overrides, aml_reparented_counts, aml_performed_by)
  VALUES (p_master, p_loser, COALESCE(p_field_overrides,'{}'::jsonb), counts, current_app_user_id());

  RETURN jsonb_build_object('status','ok','master',p_master,'merged',p_loser,'reparented',counts);
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_account_merge(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.merge_accounts(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_account_merge(uuid) TO authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.merge_accounts(uuid, uuid, jsonb) TO authenticated, postgres, service_role;

NOTIFY pgrst, 'reload schema';
