-- =============================================================================
-- Account Merge tool — resolve duplicate accounts (Salesforce "Merge Accounts")
--
-- merge_accounts(master, loser, field_overrides) atomically:
--   1. applies the chosen surviving field values to the master,
--   2. reparents EVERY child record that references accounts.id (discovered live
--      from the catalog, so new child tables are covered automatically) from the
--      loser to the master,
--   3. soft-deletes the loser (account_is_deleted = true — recoverable),
--   4. writes an account_merge_log row for audit / recovery.
-- preview_account_merge(loser) returns the per-table child counts that would
-- move, so the UI can show the blast radius before committing.
--
-- The whole merge runs in one transaction: any failure (e.g. a unique-constraint
-- clash on a child table) rolls the entire thing back — no partial merges.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.account_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aml_master_account_id uuid NOT NULL REFERENCES public.accounts(id),
  aml_merged_account_id uuid NOT NULL REFERENCES public.accounts(id),
  aml_field_overrides jsonb DEFAULT '{}'::jsonb,
  aml_reparented_counts jsonb DEFAULT '{}'::jsonb,
  aml_performed_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.account_merge_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_select_account_merge_log ON public.account_merge_log;
CREATE POLICY app_select_account_merge_log ON public.account_merge_log
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);

-- ── Preview: per-table child counts that would move (read-only) ──────────────
CREATE OR REPLACE FUNCTION public.preview_account_merge(p_loser uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_catalog'
AS $function$
DECLARE rec record; n bigint; counts jsonb := '{}'::jsonb;
BEGIN
  IF current_app_user_id() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  FOR rec IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
      AND ccu.table_name='accounts' AND ccu.column_name='id'
      AND tc.table_name <> 'account_merge_log'
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

  -- 2. Reparent every child FK pointing at accounts.id (discovered live)
  FOR rec IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
      AND ccu.table_name='accounts' AND ccu.column_name='id'
      AND tc.table_name <> 'account_merge_log'
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
