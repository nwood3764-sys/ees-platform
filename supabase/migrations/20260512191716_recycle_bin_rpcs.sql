-- ============================================================================
-- 20260512191716 recycle_bin_rpcs
--
-- Phase 1 of the recycle bin spec from anura-data-standards.md:
--   • restore_record(p_table, p_record_id) — flips is_deleted back to
--     false and clears the deletion audit trio (deletion_reason /
--     deleted_at / deleted_by) where those columns exist on the target
--     table. Audit trigger emits a RESTORE row automatically.
--   • fetch_deleted_records(p_table, p_limit) — returns soft-deleted
--     rows from a single table with a normalized shape
--     {id, name, deletion_reason, deleted_at, deleted_by}. SECURITY
--     DEFINER + auth-gated so deleted rows are visible to the recycle
--     bin UI even when the table's RLS policies would otherwise hide them.
--
-- The deletion-column naming follows the same prefix as the is_deleted
-- column. The functions derive the prefix from ees_table_metadata, then
-- probe pg_attribute for which audit columns actually exist on the
-- target table (some tables only have deletion_reason; permission_sets
-- in particular lacks _at and _by). Missing columns produce NULL in
-- the result; restore skips clearing what doesn't exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.restore_record(
  p_table     text,
  p_record_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller       uuid := public.current_app_user_id();
  v_meta         jsonb;
  v_deleted_col  text;
  v_prefix       text;
  v_reason_col   text;
  v_at_col       text;
  v_by_col       text;
  v_has_reason   boolean;
  v_has_at       boolean;
  v_has_by       boolean;
  v_set_clauses  text[];
  v_sql          text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'restore_record: must be authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_table IS NULL OR p_record_id IS NULL THEN
    RAISE EXCEPTION 'restore_record: table and record_id are required';
  END IF;

  v_meta := public.ees_table_metadata(p_table);
  IF v_meta IS NULL OR v_meta->>'is_deleted_column' IS NULL THEN
    RAISE EXCEPTION 'restore_record: table % is not soft-deletable', p_table
      USING ERRCODE = '22023';
  END IF;
  v_deleted_col := v_meta->>'is_deleted_column';
  v_prefix      := regexp_replace(v_deleted_col, 'is_deleted$', '');
  v_reason_col  := v_prefix || 'deletion_reason';
  v_at_col      := v_prefix || 'deleted_at';
  v_by_col      := v_prefix || 'deleted_by';

  SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid
    JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=p_table AND a.attname=v_reason_col AND a.attnum>0)
    INTO v_has_reason;
  SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid
    JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=p_table AND a.attname=v_at_col AND a.attnum>0)
    INTO v_has_at;
  SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid
    JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=p_table AND a.attname=v_by_col AND a.attnum>0)
    INTO v_has_by;

  v_set_clauses := ARRAY[quote_ident(v_deleted_col) || ' = false'];
  IF v_has_reason THEN v_set_clauses := v_set_clauses || (quote_ident(v_reason_col) || ' = NULL'); END IF;
  IF v_has_at     THEN v_set_clauses := v_set_clauses || (quote_ident(v_at_col)     || ' = NULL'); END IF;
  IF v_has_by     THEN v_set_clauses := v_set_clauses || (quote_ident(v_by_col)     || ' = NULL'); END IF;

  v_sql := format(
    'UPDATE public.%I SET %s WHERE id = $1 AND %I = true RETURNING id',
    p_table, array_to_string(v_set_clauses, ', '), v_deleted_col
  );

  EXECUTE v_sql INTO v_caller USING p_record_id;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'restore_record: record % not found in % or already not deleted',
      p_record_id, p_table USING ERRCODE = '02000';
  END IF;
  RETURN v_caller;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_record(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.restore_record(text, uuid) IS
  'Recycle bin Phase 1: restore a soft-deleted record. Clears the is_deleted column plus deletion audit trio. Audit trigger on the table emits a RESTORE row to audit_log automatically.';

CREATE OR REPLACE FUNCTION public.fetch_deleted_records(
  p_table text,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  id              uuid,
  name            text,
  deletion_reason text,
  deleted_at      timestamptz,
  deleted_by      uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller     uuid := public.current_app_user_id();
  v_meta       jsonb;
  v_deleted    text;
  v_prefix     text;
  v_reason     text;
  v_at         text;
  v_by         text;
  v_name_col   text;
  v_recnum_col text;
  v_display    text;
  v_safe_limit integer;
  v_sql        text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'fetch_deleted_records: must be authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_table IS NULL THEN
    RAISE EXCEPTION 'fetch_deleted_records: table is required';
  END IF;
  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);

  v_meta := public.ees_table_metadata(p_table);
  IF v_meta IS NULL OR v_meta->>'is_deleted_column' IS NULL THEN
    RAISE EXCEPTION 'fetch_deleted_records: table % is not soft-deletable', p_table
      USING ERRCODE = '22023';
  END IF;
  v_deleted := v_meta->>'is_deleted_column';
  v_prefix  := regexp_replace(v_deleted, 'is_deleted$', '');

  SELECT a.attname INTO v_reason FROM pg_attribute a
    JOIN pg_class c ON a.attrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=p_table AND a.attname=v_prefix||'deletion_reason' AND a.attnum>0 LIMIT 1;
  SELECT a.attname INTO v_at FROM pg_attribute a
    JOIN pg_class c ON a.attrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=p_table AND a.attname=v_prefix||'deleted_at' AND a.attnum>0 LIMIT 1;
  SELECT a.attname INTO v_by FROM pg_attribute a
    JOIN pg_class c ON a.attrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=p_table AND a.attname=v_prefix||'deleted_by' AND a.attnum>0 LIMIT 1;

  v_recnum_col := v_prefix || 'record_number';
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid
    JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=p_table AND a.attname=v_recnum_col AND a.attnum>0)
  THEN v_recnum_col := NULL; END IF;

  v_name_col := v_prefix || 'name';
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid
    JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=p_table AND a.attname=v_name_col AND a.attnum>0)
  THEN v_name_col := NULL; END IF;

  v_display := CASE
    WHEN v_recnum_col IS NOT NULL AND v_name_col IS NOT NULL
      THEN format('COALESCE(%I, %I, id::text)', v_recnum_col, v_name_col)
    WHEN v_recnum_col IS NOT NULL
      THEN format('COALESCE(%I, id::text)', v_recnum_col)
    WHEN v_name_col IS NOT NULL
      THEN format('COALESCE(%I, id::text)', v_name_col)
    ELSE 'id::text'
  END;

  v_sql := format(
    'SELECT id, %s, %s, %s, %s FROM public.%I WHERE %I = true ORDER BY %s DESC NULLS LAST LIMIT %s',
    v_display,
    COALESCE(quote_ident(v_reason), 'NULL::text'),
    COALESCE(quote_ident(v_at),     'NULL::timestamptz'),
    COALESCE(quote_ident(v_by),     'NULL::uuid'),
    p_table, v_deleted,
    COALESCE(quote_ident(v_at), 'id'),
    v_safe_limit
  );
  RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_deleted_records(text, integer) TO authenticated;

COMMENT ON FUNCTION public.fetch_deleted_records(text, integer) IS
  'Recycle bin Phase 1: returns soft-deleted rows from a single table with normalized display name + deletion audit columns where they exist.';
