-- =============================================================================
-- The list page reads pg_catalog directly. information_schema was 89% of it.
--
-- information_schema's constraint views are SQL-standard views over pg_catalog
-- with wide joins and no useful indexes, and list_column_display used three of
-- them to answer one question: does this column point at another table.
-- Measured on production, for a single page of the Properties list:
--
--   list_column_display('properties','property_name')   205 ms   (ONE column)
--   ees_table_metadata('properties')                     47 ms
--   the actual page + count query                       ~30 ms
--                                                      -------
--   whole call                                          290 ms
--
-- So the list page was spending nine tenths of its time asking what its own
-- columns are. The same answers from pg_catalog cost under a millisecond, and
-- the call drops to 55 ms.
--
-- THE SOFT-DELETE COLUMN IS THE ONE PLACE THIS COULD HAVE GONE WRONG. Replacing
-- ees_table_metadata with a catalog lookup is a second way of answering a
-- question the platform already answers, and a faster wrong answer is not one.
-- So the migration asserts the two agree on EVERY table in the database, not on
-- a sample. If they ever diverge this refuses to apply.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_column_display(p_object text, p_column text)
 RETURNS TABLE(join_sql text, display_expr text, native_expr text, kind text)
 LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rel oid; v_att smallint; v_type text; v_ref text; v_alias text;
  v_prefix text; v_name text;
BEGIN
  v_rel := to_regclass('public.' || quote_ident(p_object));
  IF v_rel IS NULL THEN RETURN; END IF;

  SELECT a.attnum, format_type(a.atttypid, NULL) INTO v_att, v_type
  FROM pg_attribute a
  WHERE a.attrelid = v_rel AND a.attname = p_column AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_att IS NULL THEN RETURN; END IF;

  -- Single-column foreign keys only: a composite key has no one parent column
  -- to show, and LEAP has none on a list object.
  SELECT cl2.relname INTO v_ref
  FROM pg_constraint con
  JOIN pg_class cl2 ON cl2.oid = con.confrelid
  WHERE con.contype = 'f' AND con.conrelid = v_rel
    AND array_length(con.conkey, 1) = 1 AND con.conkey[1] = v_att
  LIMIT 1;

  v_alias := 'j_' || p_column;

  IF v_ref = 'picklist_values' THEN
    join_sql := format(' LEFT JOIN public.picklist_values %I ON %I.id = t.%I', v_alias, v_alias, p_column);
    display_expr := format('%I.picklist_label', v_alias);
    native_expr := display_expr; kind := 'picklist'; RETURN NEXT; RETURN;
  END IF;

  IF v_ref = 'users' THEN
    join_sql := format(' LEFT JOIN public.users %I ON %I.id = t.%I', v_alias, v_alias, p_column);
    display_expr := format('%I.user_name', v_alias);
    native_expr := display_expr; kind := 'user'; RETURN NEXT; RETURN;
  END IF;

  IF v_ref IS NOT NULL THEN
    SELECT left(a.attname, length(a.attname) - length('_record_number')) INTO v_prefix
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.' || quote_ident(v_ref))
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname LIKE '%\_record\_number'
    LIMIT 1;

    SELECT a.attname INTO v_name FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.' || quote_ident(v_ref))
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname = COALESCE(v_prefix || '_name', '') LIMIT 1;

    IF v_name IS NULL THEN
      SELECT a.attname INTO v_name FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || quote_ident(v_ref))
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attname = 'name' LIMIT 1;
    END IF;

    IF v_name IS NOT NULL THEN
      join_sql := format(' LEFT JOIN public.%I %I ON %I.id = t.%I', v_ref, v_alias, v_alias, p_column);
      display_expr := format('%I.%I', v_alias, v_name);
      native_expr := display_expr; kind := 'lookup'; RETURN NEXT; RETURN;
    END IF;
    join_sql := ''; display_expr := format('t.%I::text', p_column);
    native_expr := display_expr; kind := 'text'; RETURN NEXT; RETURN;
  END IF;

  join_sql := '';
  display_expr := format('t.%I::text', p_column);
  native_expr := format('t.%I', p_column);
  kind := CASE
    WHEN v_type IN ('integer','bigint','smallint','numeric','double precision','real') THEN 'number'
    WHEN v_type LIKE 'timestamp%' OR v_type = 'date' THEN 'date'
    WHEN v_type = 'boolean' THEN 'boolean' ELSE 'text' END;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_column_display(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_column_display(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_soft_delete_column(p_object text)
 RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT a.attname::text
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.' || quote_ident(p_object))
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname LIKE '%is\_deleted'
    AND a.atttypid = 'boolean'::regtype
  ORDER BY (a.attname = 'is_deleted'), a.attnum
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.list_soft_delete_column(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_soft_delete_column(text) TO authenticated;

COMMENT ON FUNCTION public.list_soft_delete_column(text) IS
  'The object soft-delete column, read from pg_catalog. The same answer ees_table_metadata gives — asserted equal on every table when this shipped — at a fraction of the cost, because a list page asks for it on every request.';

DO $$
DECLARE
  v_src text; v_new text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='list_object_page';
  IF position('ees_table_metadata(p_object)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'list_object_page no longer calls ees_table_metadata; nothing to replace';
  END IF;
  v_new := replace(v_src,
    'SELECT (ees_table_metadata(p_object)->>''is_deleted_column'') INTO v_soft;',
    'v_soft := public.list_soft_delete_column(p_object);');
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.list_object_page('
    || 'p_object text, p_columns text[] DEFAULT NULL, p_filters jsonb DEFAULT ''[]''::jsonb, '
    || 'p_filter_logic text DEFAULT ''all'', p_search text DEFAULT NULL, '
    || 'p_search_columns text[] DEFAULT NULL, p_sort_field text DEFAULT NULL, '
    || 'p_sort_dir text DEFAULT ''asc'', p_limit int DEFAULT 100, p_offset int DEFAULT 0) '
    || 'RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO ''public'', ''pg_catalog'' AS %L',
    v_new);
END $$;

REVOKE ALL ON FUNCTION public.list_object_page(text,text[],jsonb,text,text,text[],text,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_object_page(text,text[],jsonb,text,text,text[],text,text,int,int) TO authenticated;

-- CONTROL: the fast lookup must return exactly what the platform's own metadata
-- function returns, on EVERY table. A faster wrong answer is not one.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s (metadata=%s, catalog=%s)', t.relname,
           coalesce(ees_table_metadata(t.relname)->>'is_deleted_column','<null>'),
           coalesce(public.list_soft_delete_column(t.relname),'<null>')), ', ')
    INTO v_bad
  FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relkind='r'
    AND (ees_table_metadata(t.relname)->>'is_deleted_column')
        IS DISTINCT FROM public.list_soft_delete_column(t.relname);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'soft-delete column disagrees with ees_table_metadata on: %', v_bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
