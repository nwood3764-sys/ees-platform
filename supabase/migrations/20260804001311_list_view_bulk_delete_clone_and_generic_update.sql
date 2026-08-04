-- ===========================================================================
-- List-view bulk actions: generic bulk UPDATE, soft-DELETE, and CLONE
--
-- Goal (Nicholas, 2026-08-04): Salesforce-parity list views on EVERY object.
-- The list view already supported multi-select + inline cell edit + single-
-- field bulk edit, but only on a hardcoded allowlist of ~30 tables, and it had
-- no bulk delete or clone. This migration makes the three bulk operations work
-- generically across all LEAP entity tables:
--
--   1. leap_audit_col()          — detect an audit/system column by suffix,
--                                  handling both prefixed (property_is_deleted)
--                                  and bare (is_deleted) naming, plus
--                                  non-derivable prefixes (ia_, spa_, va_).
--   2. leap_bulk_op_allowed()    — table guard: real public base table with an
--                                  id column, minus a small denylist of
--                                  identity/security/metadata tables.
--   3. bulk_update_records()     — REWRITTEN to derive audit columns generically
--                                  instead of a fixed CASE + allowlist. Same
--                                  signature and return shape; `properties`
--                                  (the only table exercising it in prod today)
--                                  behaves identically.
--   4. bulk_soft_delete_records()— NEW. Soft-deletes each id (sets the detected
--                                  is_deleted column true, records deletion
--                                  reason + deleted_at/by where those columns
--                                  exist). The core-table enforce_soft_delete_
--                                  audit trigger still fires; we set the same
--                                  values first so it no-ops.
--   5. bulk_clone_records()      — NEW. Inserts a copy of each source row with a
--                                  fresh id, blanked record-number (trigger
--                                  refills), reset audit + soft-delete columns,
--                                  and " (Copy)" appended to the primary name.
--
-- All functions are SECURITY INVOKER (like the original bulk_update_records) —
-- RLS governs what the caller may read/update/insert; the table guard and
-- system-column checks are defense-in-depth. No SECURITY DEFINER, so no new
-- security-advisor lints.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- leap_audit_col(p_table, p_suffix)
-- Returns the name of the column on p_table that carries the given audit
-- suffix, or NULL if none. Matches the bare column (is_deleted) or any
-- prefixed variant (property_is_deleted, ia_is_deleted). When several match,
-- prefers an exact match, then the shortest name (the primary, e.g.
-- property_name over property_owner_name).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leap_audit_col(p_table text, p_suffix text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = p_table
    AND (column_name = p_suffix OR column_name LIKE '%\_' || p_suffix)
  ORDER BY (column_name = p_suffix) DESC, length(column_name) ASC
  LIMIT 1
$function$;

-- ---------------------------------------------------------------------------
-- leap_bulk_op_allowed(p_table)
-- True when p_table is a real public base table with an id column and is not
-- an identity / security / metadata table that must never be bulk-edited,
-- cloned, or deleted from a list view. RLS is the real gate; this keeps the
-- obviously-wrong targets out of reach entirely.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leap_bulk_op_allowed(p_table text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    p_table IS NOT NULL
    AND p_table NOT IN (
      -- identity & access control — provisioned by admins, never list-edited
      'users', 'portal_users', 'roles', 'permission_sets',
      'permission_set_assignments', 'role_permissions',
      'object_permissions', 'field_permissions', 'role_view_as_grants',
      -- platform metadata / audit — edited through their own admin tools
      'picklist_values', 'audit_log', 'schema_migrations',
      'saved_list_views', 'list_view_user_defaults'
    )
    AND p_table NOT LIKE 'auth\_%'
    AND EXISTS (
      SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = p_table
        AND t.table_type = 'BASE TABLE'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = p_table
        AND c.column_name = 'id'
    )
$function$;

-- ---------------------------------------------------------------------------
-- bulk_update_records(p_table, p_record_ids, p_updates, p_actor_id)
-- Generic rewrite. Same signature and JSON return as the original.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_update_records(p_table text, p_record_ids uuid[], p_updates jsonb, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total        int := COALESCE(array_length(p_record_ids, 1), 0);
  v_updated      int := 0;
  v_errored      int := 0;
  v_errors       jsonb := '[]'::jsonb;
  v_record_id    uuid;
  v_rc           int;
  v_set_clause   text := '';
  v_key          text;
  v_col_exists   boolean;
  v_update_sql   text;
  v_error_msg    text;
  v_audit_updater_col text;
  v_audit_at_col text;
BEGIN
  IF p_table IS NULL OR p_table = '' THEN
    RAISE EXCEPTION 'p_table is required';
  END IF;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'p_record_ids must contain at least one UUID';
  END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'p_updates must be a JSON object';
  END IF;
  IF (SELECT COUNT(*) FROM jsonb_object_keys(p_updates)) = 0 THEN
    RAISE EXCEPTION 'p_updates must contain at least one column';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id is required';
  END IF;
  IF NOT public.leap_bulk_op_allowed(p_table) THEN
    RAISE EXCEPTION 'Bulk update not allowed on table %', p_table;
  END IF;

  -- Reject attempts to write system-managed columns (audit, soft-delete,
  -- record number, primary key) directly.
  FOR v_key IN SELECT jsonb_object_keys(p_updates) LOOP
    IF v_key = 'id'
       OR v_key LIKE '%_record_number'
       OR v_key LIKE '%_created_at' OR v_key LIKE '%_created_by'
       OR v_key LIKE '%_updated_at' OR v_key LIKE '%_updated_by'
       OR v_key LIKE '%_deleted_at' OR v_key LIKE '%_deleted_by'
       OR v_key LIKE '%_is_deleted' OR v_key LIKE '%_deletion_reason'
       OR v_key IN ('created_at','created_by','updated_at','updated_by',
                    'deleted_at','deleted_by','is_deleted','deletion_reason')
    THEN
      RAISE EXCEPTION 'Column % is system-managed and not user-editable', v_key;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=p_table AND column_name=v_key
    ) INTO v_col_exists;
    IF NOT v_col_exists THEN
      RAISE EXCEPTION 'Column % does not exist on table %', v_key, p_table;
    END IF;
  END LOOP;

  -- Build the SET clause for the user-supplied columns.
  SELECT string_agg(
           quote_ident(k) || ' = ' ||
           CASE
             WHEN jsonb_typeof(p_updates -> k) = 'null'
               THEN 'NULL'
             ELSE '(' || quote_literal(p_updates ->> k) || ')::' ||
                  (SELECT data_type FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=p_table AND column_name=k)
           END,
           ', '
         )
    INTO v_set_clause
    FROM jsonb_object_keys(p_updates) k;

  -- Append audit columns when this table has them (some, e.g. tasks/documents,
  -- have no updated_by/updated_at at all).
  v_audit_updater_col := public.leap_audit_col(p_table, 'updated_by');
  v_audit_at_col      := public.leap_audit_col(p_table, 'updated_at');
  IF v_audit_updater_col IS NOT NULL THEN
    v_set_clause := v_set_clause
      || ', ' || quote_ident(v_audit_updater_col) || ' = ' || quote_literal(p_actor_id::text) || '::uuid';
  END IF;
  IF v_audit_at_col IS NOT NULL THEN
    v_set_clause := v_set_clause
      || ', ' || quote_ident(v_audit_at_col) || ' = now()';
  END IF;

  FOREACH v_record_id IN ARRAY p_record_ids LOOP
    BEGIN
      v_update_sql := 'UPDATE ' || quote_ident(p_table) ||
                      ' SET '  || v_set_clause ||
                      ' WHERE id = ' || quote_literal(v_record_id::text) || '::uuid';
      -- EXECUTE does not set FOUND; use ROW_COUNT to detect whether the row
      -- was actually updated (an unknown id / RLS-denied row affects 0 rows).
      EXECUTE v_update_sql;
      GET DIAGNOSTICS v_rc = ROW_COUNT;
      IF v_rc > 0 THEN
        v_updated := v_updated + 1;
      ELSE
        v_errored := v_errored + 1;
        v_errors := v_errors || jsonb_build_object(
          'record_id', v_record_id,
          'error', 'Record not found or RLS denied update'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errored := v_errored + 1;
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_object(
        'record_id', v_record_id,
        'error',     v_error_msg
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'records_total',   v_total,
    'records_updated', v_updated,
    'records_errored', v_errored,
    'errors',          v_errors
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- bulk_soft_delete_records(p_table, p_record_ids, p_actor_id, p_reason)
-- Soft-deletes each record. Sets the detected is_deleted column to true and,
-- where the columns exist, deletion_reason / deleted_at / deleted_by. Only
-- flips rows that are currently active (WHERE is_deleted = false), so a
-- re-delete of an already-deleted row is reported, not silently counted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_soft_delete_records(p_table text, p_record_ids uuid[], p_actor_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total     int := COALESCE(array_length(p_record_ids, 1), 0);
  v_deleted   int := 0;
  v_errored   int := 0;
  v_errors    jsonb := '[]'::jsonb;
  v_record_id uuid;
  v_rc        int;
  v_del_col   text;
  v_reason_col text;
  v_at_col    text;
  v_by_col    text;
  v_set       text;
  v_sql       text;
  v_error_msg text;
BEGIN
  IF p_table IS NULL OR p_table = '' THEN
    RAISE EXCEPTION 'p_table is required';
  END IF;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'p_record_ids must contain at least one UUID';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id is required';
  END IF;
  IF NOT public.leap_bulk_op_allowed(p_table) THEN
    RAISE EXCEPTION 'Bulk delete not allowed on table %', p_table;
  END IF;

  v_del_col := public.leap_audit_col(p_table, 'is_deleted');
  IF v_del_col IS NULL THEN
    RAISE EXCEPTION 'Table % has no soft-delete column', p_table;
  END IF;
  v_reason_col := public.leap_audit_col(p_table, 'deletion_reason');
  v_at_col     := public.leap_audit_col(p_table, 'deleted_at');
  v_by_col     := public.leap_audit_col(p_table, 'deleted_by');

  v_set := quote_ident(v_del_col) || ' = true';
  IF v_reason_col IS NOT NULL AND p_reason IS NOT NULL AND p_reason <> '' THEN
    v_set := v_set || ', ' || quote_ident(v_reason_col) || ' = ' || quote_literal(p_reason);
  END IF;
  IF v_at_col IS NOT NULL THEN
    v_set := v_set || ', ' || quote_ident(v_at_col) || ' = now()';
  END IF;
  IF v_by_col IS NOT NULL THEN
    v_set := v_set || ', ' || quote_ident(v_by_col) || ' = ' || quote_literal(p_actor_id::text) || '::uuid';
  END IF;

  FOREACH v_record_id IN ARRAY p_record_ids LOOP
    BEGIN
      v_sql := 'UPDATE ' || quote_ident(p_table) ||
               ' SET '  || v_set ||
               ' WHERE id = ' || quote_literal(v_record_id::text) || '::uuid' ||
               ' AND ' || quote_ident(v_del_col) || ' = false';
      EXECUTE v_sql;
      GET DIAGNOSTICS v_rc = ROW_COUNT;
      IF v_rc > 0 THEN
        v_deleted := v_deleted + 1;
      ELSE
        v_errored := v_errored + 1;
        v_errors := v_errors || jsonb_build_object(
          'record_id', v_record_id,
          'error', 'Record not found, already deleted, or RLS denied delete'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errored := v_errored + 1;
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_object('record_id', v_record_id, 'error', v_error_msg);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'records_total',   v_total,
    'records_deleted', v_deleted,
    'records_errored', v_errored,
    'errors',          v_errors
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- bulk_clone_records(p_table, p_record_ids, p_actor_id)
-- Inserts a copy of each source row. Copies every ordinary column; assigns a
-- fresh id; blanks record-number columns (their BEFORE INSERT trigger refills);
-- resets audit (created/updated_by = actor, created/updated_at = now()) and
-- soft-delete columns; and appends " (Copy)" to the primary name column.
-- Generated/identity columns are skipped so the INSERT is legal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_clone_records(p_table text, p_record_ids uuid[], p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total     int := COALESCE(array_length(p_record_ids, 1), 0);
  v_cloned    int := 0;
  v_errored   int := 0;
  v_errors    jsonb := '[]'::jsonb;
  v_new_ids   jsonb := '[]'::jsonb;
  v_record_id uuid;
  v_new_id    uuid;
  v_prefix    text;
  v_del_col   text;
  v_name_col  text;
  v_cols      text := '';
  v_vals      text := '';
  v_col       text;
  v_sql       text;
  v_error_msg text;
  r           record;
BEGIN
  IF p_table IS NULL OR p_table = '' THEN
    RAISE EXCEPTION 'p_table is required';
  END IF;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'p_record_ids must contain at least one UUID';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id is required';
  END IF;
  IF NOT public.leap_bulk_op_allowed(p_table) THEN
    RAISE EXCEPTION 'Bulk clone not allowed on table %', p_table;
  END IF;

  -- Derive the table prefix from its is_deleted column so we can find the
  -- primary name column (prefix_name), the one we tag with " (Copy)".
  v_del_col := public.leap_audit_col(p_table, 'is_deleted');
  v_prefix  := CASE
                 WHEN v_del_col IS NULL THEN NULL
                 WHEN v_del_col = 'is_deleted' THEN NULL
                 ELSE left(v_del_col, length(v_del_col) - length('_is_deleted'))
               END;
  IF v_prefix IS NOT NULL AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=p_table AND column_name = v_prefix || '_name'
     ) THEN
    v_name_col := v_prefix || '_name';
  ELSE
    SELECT column_name INTO v_name_col
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=p_table
      AND (column_name = 'name' OR column_name LIKE '%\_name')
    ORDER BY (column_name = 'name') DESC, length(column_name) ASC
    LIMIT 1;
  END IF;

  -- Build the column + value lists once (identical for every source row).
  FOR r IN
    SELECT column_name, is_generated, is_identity
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=p_table
    ORDER BY ordinal_position
  LOOP
    v_col := r.column_name;

    -- Skip generated / identity columns — the DB computes them.
    CONTINUE WHEN r.is_generated = 'ALWAYS' OR r.is_identity = 'YES';
    -- Skip columns we want to default (deletion breadcrumbs) rather than copy.
    CONTINUE WHEN v_col = 'deletion_reason' OR v_col LIKE '%\_deletion_reason';
    CONTINUE WHEN v_col = 'deleted_at' OR v_col LIKE '%\_deleted_at';
    CONTINUE WHEN v_col = 'deleted_by' OR v_col LIKE '%\_deleted_by';

    IF v_cols <> '' THEN v_cols := v_cols || ', '; v_vals := v_vals || ', '; END IF;
    v_cols := v_cols || quote_ident(v_col);

    IF v_col = 'id' THEN
      v_vals := v_vals || 'gen_random_uuid()';
    ELSIF v_col = 'is_deleted' OR v_col LIKE '%\_is_deleted' THEN
      v_vals := v_vals || 'false';
    ELSIF v_col = 'record_number' OR v_col LIKE '%\_record_number' THEN
      v_vals := v_vals || quote_literal('');
    ELSIF v_col = 'created_at' OR v_col LIKE '%\_created_at'
       OR v_col = 'updated_at' OR v_col LIKE '%\_updated_at' THEN
      v_vals := v_vals || 'now()';
    ELSIF v_col = 'created_by' OR v_col LIKE '%\_created_by'
       OR v_col = 'updated_by' OR v_col LIKE '%\_updated_by' THEN
      v_vals := v_vals || quote_literal(p_actor_id::text) || '::uuid';
    ELSIF v_name_col IS NOT NULL AND v_col = v_name_col THEN
      -- Append " (Copy)" to the primary name; keep null names null.
      v_vals := v_vals || 'CASE WHEN ' || quote_ident(v_col) ||
                ' IS NULL THEN NULL ELSE ' || quote_ident(v_col) ||
                ' || ' || quote_literal(' (Copy)') || ' END';
    ELSE
      v_vals := v_vals || quote_ident(v_col);
    END IF;
  END LOOP;

  FOREACH v_record_id IN ARRAY p_record_ids LOOP
    BEGIN
      v_new_id := NULL;
      v_sql := 'INSERT INTO ' || quote_ident(p_table) || ' (' || v_cols || ') ' ||
               'SELECT ' || v_vals || ' FROM ' || quote_ident(p_table) ||
               ' WHERE id = ' || quote_literal(v_record_id::text) || '::uuid RETURNING id';
      EXECUTE v_sql INTO v_new_id;
      IF v_new_id IS NOT NULL THEN
        v_cloned := v_cloned + 1;
        v_new_ids := v_new_ids || to_jsonb(v_new_id);
      ELSE
        v_errored := v_errored + 1;
        v_errors := v_errors || jsonb_build_object(
          'record_id', v_record_id,
          'error', 'Source record not found or RLS denied read/insert'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errored := v_errored + 1;
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_object('record_id', v_record_id, 'error', v_error_msg);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'records_total',   v_total,
    'records_cloned',  v_cloned,
    'records_errored', v_errored,
    'new_ids',         v_new_ids,
    'errors',          v_errors
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Grants. Mirror bulk_update_records: callable by authenticated app users;
-- RLS on each table governs what actually happens. postgres/service_role keep
-- full access for server-side jobs.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.leap_audit_col(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leap_audit_col(text, text) TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.leap_bulk_op_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leap_bulk_op_allowed(text) TO authenticated, postgres, service_role;

GRANT EXECUTE ON FUNCTION public.bulk_update_records(text, uuid[], jsonb, uuid) TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.bulk_soft_delete_records(text, uuid[], uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_soft_delete_records(text, uuid[], uuid, text) TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.bulk_clone_records(text, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_clone_records(text, uuid[], uuid) TO authenticated, postgres, service_role;

NOTIFY pgrst, 'reload schema';
