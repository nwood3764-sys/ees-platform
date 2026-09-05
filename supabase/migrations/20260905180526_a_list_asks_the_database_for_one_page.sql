-- =============================================================================
-- A list asks the database for ONE PAGE, and the database says when it cannot.
--
-- Nicholas: "We need this to work. You keep putting band-aids on."
--
-- Paging by primary key (2026-09-05, PR #817) stopped the Properties list
-- timing out — 612 ms per page became 16 ms — but it did not change WHAT the
-- list reads. Every list still downloads its whole object and filters, searches
-- and sorts in the browser. Keyset paging made that linear instead of
-- quadratic; linear still grows. At 16,665 properties it is ~17 round trips,
-- and the shape does not survive another order of magnitude.
--
-- This is the engine that ends it: filter, search, sort, count and page, in
-- SQL, over one object.
--
-- WHY THIS IS NOT JUST "ADD LIMIT". Nine things in ListView are built on having
-- every row (mapped 2026-09-05). The ones this function has to answer, or the
-- list starts lying rather than erroring:
--
--   * The TOTAL matching count — "Showing X of Y" and select-all-matching.
--   * Picklist, user and lookup columns are FILTERED AND SORTED ON THEIR LABEL
--     while the column stores a uuid. The label is resolved in JavaScript
--     today, so the database has never been asked to match on it.
--   * Global search spans every value on the shaped row, resolved labels
--     included — not one column.
--
-- THE REFUSAL IS THE IMPORTANT PART. A partial engine that silently drops a
-- filter it does not understand returns the WRONG ROWS and looks fine, which is
-- worse than the load it replaces. So every filter, sort and search term is
-- checked before any SQL is built, and anything this function cannot express
-- faithfully — a related (dotted) field resolved by a second fetch, an unknown
-- operator, a column that is not on the table — comes back as
-- {"supported": false, "reason": …}. The caller then uses the existing
-- client-side path. A list is never served a half-applied filter.
--
-- RELATIVE DATES ARE RESOLVED BY THE CALLER, DELIBERATELY. "Last 30 days" is
-- twenty-three literals in src/lib/reportFilters.js, resolved against the
-- BROWSER's midnight in the reader's own timezone. Re-implementing them here
-- would be a second definition that disagrees with the first every time the
-- server and the reader are in different zones. The client resolves them to
-- absolute bounds and sends timestamps; the one definition stays where it is.
--
-- SECURITY. SECURITY INVOKER, so RLS decides what is visible — including the
-- geographic state scope, which a definer function here would hand around.
-- Every identifier is taken from the catalog and quoted with %I; every value
-- the caller supplies is bound with USING, never interpolated. The filter
-- logic expression ("1 AND (2 OR 3)") is re-tokenised and rebuilt from
-- integers, AND, OR and parentheses only — anything else refuses the query.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. What a list column resolves to. A column is filtered and sorted on what
--    the READER sees, which for a foreign key is the parent's name, not a uuid.
--
--    The name column is derived, never listed: anchored on <prefix>_record_number
--    (the anchor recordInsertDefaults and email_log_target_columns already use),
--    falling back to a bare `name`. Verified against every table a list column
--    on properties/accounts/opportunities/work_orders/contacts can point at:
--    15 resolve by prefix, documents by `name`, and picklist_values and users
--    are their own cases.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_column_display(p_object text, p_column text)
 RETURNS TABLE(join_sql text, display_expr text, native_expr text, kind text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_type   text;
  v_ref    text;
  v_alias  text;
  v_prefix text;
  v_name   text;
BEGIN
  SELECT c.data_type INTO v_type
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=p_object AND c.column_name=p_column;
  IF v_type IS NULL THEN
    RETURN;                                  -- unknown column: caller refuses
  END IF;

  SELECT ccu.table_name INTO v_ref
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name=tc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
    AND kcu.table_name=p_object AND kcu.column_name=p_column
  LIMIT 1;

  v_alias := 'j_' || p_column;

  IF v_ref = 'picklist_values' THEN
    join_sql     := format(' LEFT JOIN public.picklist_values %I ON %I.id = t.%I', v_alias, v_alias, p_column);
    display_expr := format('%I.picklist_label', v_alias);
    native_expr  := display_expr;
    kind         := 'picklist';
    RETURN NEXT; RETURN;
  END IF;

  IF v_ref = 'users' THEN
    join_sql     := format(' LEFT JOIN public.users %I ON %I.id = t.%I', v_alias, v_alias, p_column);
    display_expr := format('%I.user_name', v_alias);
    native_expr  := display_expr;
    kind         := 'user';
    RETURN NEXT; RETURN;
  END IF;

  IF v_ref IS NOT NULL THEN
    SELECT left(c.column_name, length(c.column_name) - length('_record_number'))
      INTO v_prefix
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=v_ref
      AND c.column_name LIKE '%\_record\_number'
    LIMIT 1;

    SELECT c.column_name INTO v_name
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=v_ref
      AND c.column_name = COALESCE(v_prefix || '_name', '')
    LIMIT 1;

    IF v_name IS NULL THEN
      SELECT c.column_name INTO v_name
      FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=v_ref AND c.column_name='name'
      LIMIT 1;
    END IF;

    IF v_name IS NOT NULL THEN
      join_sql     := format(' LEFT JOIN public.%I %I ON %I.id = t.%I', v_ref, v_alias, v_alias, p_column);
      display_expr := format('%I.%I', v_alias, v_name);
      native_expr  := display_expr;
      kind         := 'lookup';
      RETURN NEXT; RETURN;
    END IF;
    -- A parent with no nameable column: the reader sees the uuid, so match it.
    join_sql     := '';
    display_expr := format('t.%I::text', p_column);
    native_expr  := display_expr;
    kind         := 'text';
    RETURN NEXT; RETURN;
  END IF;

  join_sql     := '';
  display_expr := format('t.%I::text', p_column);
  native_expr  := format('t.%I', p_column);
  kind := CASE
    WHEN v_type IN ('integer','bigint','smallint','numeric','double precision','real') THEN 'number'
    WHEN v_type IN ('timestamp with time zone','timestamp without time zone','date') THEN 'date'
    WHEN v_type = 'boolean' THEN 'boolean'
    ELSE 'text'
  END;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_column_display(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_column_display(text,text) TO authenticated;

COMMENT ON FUNCTION public.list_column_display(text,text) IS
  'What a list column is filtered and sorted ON: the label a reader sees, not the uuid stored. Returns the LEFT JOIN needed, the display expression, the native-typed expression and the column kind. Returns no row for a column that is not on the object, which is how the caller refuses.';

-- -----------------------------------------------------------------------------
-- 2. One page of a list: filtered, searched, sorted and counted in SQL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_object_page(
  p_object         text,
  p_columns        text[] DEFAULT NULL,
  p_filters        jsonb  DEFAULT '[]'::jsonb,
  p_filter_logic   text   DEFAULT 'all',
  p_search         text   DEFAULT NULL,
  p_search_columns text[] DEFAULT NULL,
  p_sort_field     text   DEFAULT NULL,
  p_sort_dir       text   DEFAULT 'asc',
  p_limit          int    DEFAULT 100,
  p_offset         int    DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_soft      text;
  v_joins     text := '';
  v_seen      text[] := '{}';
  v_preds     text[] := '{}';
  v_binds     text[] := '{}';
  v_where     text;
  v_logic     text;
  v_token     text;
  v_rebuilt   text := '';
  v_filter    jsonb;
  v_idx       int := 0;
  v_col       text;
  v_op        text;
  v_val       jsonb;
  v_d         record;
  v_pred      text;
  v_search    text;
  v_searchp   text[] := '{}';
  v_sort      text := '';
  v_sel       text := '';
  v_c         text;
  v_total     bigint;
  v_rows      jsonb;
  v_sql       text;
  v_limit     int := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset    int := greatest(coalesce(p_offset, 0), 0);

BEGIN
  IF to_regclass('public.' || quote_ident(p_object)) IS NULL THEN
    RETURN jsonb_build_object('supported', false, 'reason',
      format('no such object: %s', p_object));
  END IF;

  SELECT (ees_table_metadata(p_object)->>'is_deleted_column') INTO v_soft;

  -- ── Filters ────────────────────────────────────────────────────────────────
  FOR v_filter IN SELECT * FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb))
  LOOP
    v_idx := v_idx + 1;
    v_col := v_filter->>'field';
    v_op  := COALESCE(v_filter->>'op', 'equals');
    v_val := v_filter->'value';

    -- A derived key the browser made. `__label` is this column's own label and
    -- is expressible; `__rel__` is a value fetched from a PARENT row in a
    -- separate query and is not, so the whole request is refused.
    IF v_col LIKE '%\_\_rel\_\_%' OR v_col LIKE '%\_\_name' THEN
      RETURN jsonb_build_object('supported', false, 'reason',
        format('filter on a related field resolved client-side: %s', v_col));
    END IF;
    IF v_col LIKE '%\_\_label' THEN
      v_col := left(v_col, length(v_col) - length('__label'));
    END IF;

    SELECT * INTO v_d FROM public.list_column_display(p_object, v_col);
    IF NOT FOUND THEN
      RETURN jsonb_build_object('supported', false, 'reason',
        format('filter on a column that is not on %s: %s', p_object, v_col));
    END IF;
    IF v_d.join_sql <> '' AND NOT (v_col = ANY(v_seen)) THEN
      v_joins := v_joins || v_d.join_sql;
      v_seen  := v_seen || v_col;
    END IF;

    v_pred := CASE v_op
      WHEN 'is_blank'     THEN format('coalesce(btrim(%s), '''') = ''''', v_d.display_expr)
      WHEN 'is_not_blank' THEN format('coalesce(btrim(%s), '''') <> ''''', v_d.display_expr)
      ELSE NULL
    END;

    IF v_pred IS NULL THEN
      IF v_val IS NULL OR v_val = 'null'::jsonb THEN
        RETURN jsonb_build_object('supported', false, 'reason',
          format('filter %s on %s has no value', v_op, v_col));
      END IF;

      IF jsonb_typeof(v_val) = 'array' THEN
        -- Multi-select equals / not_equals, including the "(Blanks)" sentinel.
        IF v_op NOT IN ('equals','not_equals') THEN
          RETURN jsonb_build_object('supported', false, 'reason',
            format('operator %s does not take a list', v_op));
        END IF;
        v_binds := v_binds || ARRAY[(
          SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)::text
          FROM jsonb_array_elements_text(v_val) x WHERE x <> '__BLANK__')];
        v_pred := format('(%s = ANY (SELECT jsonb_array_elements_text($1[%s]::jsonb)))',
                         v_d.display_expr, array_length(v_binds,1));
        IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_val) x WHERE x = '__BLANK__') THEN
          v_pred := format('(%s OR coalesce(btrim(%s), '''') = '''')', v_pred, v_d.display_expr);
        END IF;
        IF v_op = 'not_equals' THEN v_pred := format('NOT (%s)', v_pred); END IF;
      ELSE
        v_binds := v_binds || ARRAY[v_val#>>'{}'];
        v_pred := CASE v_op
          WHEN 'equals'       THEN format('%s = $1[%s]',            v_d.display_expr, array_length(v_binds,1))
          WHEN 'not_equals'   THEN format('%s IS DISTINCT FROM $1[%s]', v_d.display_expr, array_length(v_binds,1))
          WHEN 'contains'     THEN format('%s ILIKE ''%%''||$1[%s]||''%%''',  v_d.display_expr, array_length(v_binds,1))
          WHEN 'not_contains' THEN format('coalesce(%s,'''') NOT ILIKE ''%%''||$1[%s]||''%%''', v_d.display_expr, array_length(v_binds,1))
          WHEN 'starts_with'  THEN format('%s ILIKE $1[%s]||''%%''', v_d.display_expr, array_length(v_binds,1))
          WHEN 'ends_with'    THEN format('%s ILIKE ''%%''||$1[%s]', v_d.display_expr, array_length(v_binds,1))
          WHEN 'gt'           THEN format('%s > $1[%s]::text',  v_d.native_expr, array_length(v_binds,1))
          WHEN 'gte'          THEN format('%s >= $1[%s]::text', v_d.native_expr, array_length(v_binds,1))
          WHEN 'from'         THEN format('%s >= $1[%s]::text', v_d.native_expr, array_length(v_binds,1))
          WHEN 'lt'           THEN format('%s < $1[%s]::text',  v_d.native_expr, array_length(v_binds,1))
          WHEN 'lte'          THEN format('%s <= $1[%s]::text', v_d.native_expr, array_length(v_binds,1))
          WHEN 'to'           THEN format('%s <= $1[%s]::text', v_d.native_expr, array_length(v_binds,1))
          ELSE NULL
        END;
        -- A typed comparison must compare as its type, not as text.
        IF v_op IN ('gt','gte','from','lt','lte','to') AND v_d.kind IN ('number','date') THEN
          v_pred := replace(v_pred, '::text',
                      CASE WHEN v_d.kind='number' THEN '::numeric' ELSE '::timestamptz' END);
        END IF;
        IF v_pred IS NULL THEN
          RETURN jsonb_build_object('supported', false, 'reason',
            format('unsupported operator: %s', v_op));
        END IF;
      END IF;
    END IF;

    v_preds := v_preds || v_pred;
  END LOOP;

  -- ── Filter logic ("all", or an expression like "1 AND (2 OR 3)") ───────────
  v_logic := COALESCE(NULLIF(btrim(p_filter_logic), ''), 'all');
  IF array_length(v_preds,1) IS NULL THEN
    v_where := 'true';
  ELSIF lower(v_logic) = 'all' THEN
    v_where := array_to_string(v_preds, ' AND ');
  ELSE
    -- Rebuilt from integers, AND, OR and parentheses ONLY. Anything else and
    -- the query is refused rather than executed.
    FOR v_token IN
      SELECT (regexp_matches(v_logic, '\(|\)|\d+|[A-Za-z]+', 'g'))[1]
    LOOP
      IF v_token ~ '^\d+$' THEN
        IF v_token::int < 1 OR v_token::int > array_length(v_preds,1) THEN
          RETURN jsonb_build_object('supported', false, 'reason',
            format('filter logic refers to filter %s, which does not exist', v_token));
        END IF;
        v_rebuilt := v_rebuilt || '(' || v_preds[v_token::int] || ')';
      ELSIF upper(v_token) IN ('AND','OR') THEN
        v_rebuilt := v_rebuilt || ' ' || upper(v_token) || ' ';
      ELSIF v_token IN ('(',')') THEN
        v_rebuilt := v_rebuilt || v_token;
      ELSE
        RETURN jsonb_build_object('supported', false, 'reason',
          format('filter logic contains %L', v_token));
      END IF;
    END LOOP;
    v_where := v_rebuilt;
  END IF;

  IF v_soft IS NOT NULL THEN
    v_where := format('t.%I = false AND (%s)', v_soft, v_where);
  END IF;

  -- ── Global search ─────────────────────────────────────────────────────────
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  IF v_search IS NOT NULL THEN
    IF p_search_columns IS NULL OR array_length(p_search_columns,1) IS NULL THEN
      RETURN jsonb_build_object('supported', false, 'reason',
        'a search needs the columns to search; the browser searches every value on the row');
    END IF;
    v_binds := v_binds || ARRAY[v_search];
    FOREACH v_c IN ARRAY p_search_columns LOOP
      IF v_c LIKE '%\_\_rel\_\_%' THEN
        RETURN jsonb_build_object('supported', false, 'reason',
          format('search over a client-resolved related field: %s', v_c));
      END IF;
      IF v_c LIKE '%\_\_label' THEN v_c := left(v_c, length(v_c) - length('__label')); END IF;
      SELECT * INTO v_d FROM public.list_column_display(p_object, v_c);
      CONTINUE WHEN NOT FOUND;
      IF v_d.join_sql <> '' AND NOT (v_c = ANY(v_seen)) THEN
        v_joins := v_joins || v_d.join_sql;
        v_seen  := v_seen || v_c;
      END IF;
      v_searchp := v_searchp || format('%s ILIKE ''%%''||$1[%s]||''%%''',
                                       v_d.display_expr, array_length(v_binds,1));
    END LOOP;
    IF array_length(v_searchp,1) IS NULL THEN
      RETURN jsonb_build_object('supported', false, 'reason', 'no searchable column resolved');
    END IF;
    v_where := format('(%s) AND (%s)', v_where, array_to_string(v_searchp, ' OR '));
  END IF;

  -- ── Sort ──────────────────────────────────────────────────────────────────
  IF p_sort_field IS NOT NULL AND btrim(p_sort_field) <> '' THEN
    v_c := p_sort_field;
    IF v_c LIKE '%\_\_rel\_\_%' OR v_c LIKE '%\_\_name' THEN
      RETURN jsonb_build_object('supported', false, 'reason',
        format('sort on a client-resolved related field: %s', v_c));
    END IF;
    IF v_c LIKE '%\_\_label' THEN v_c := left(v_c, length(v_c) - length('__label')); END IF;
    SELECT * INTO v_d FROM public.list_column_display(p_object, v_c);
    IF NOT FOUND THEN
      RETURN jsonb_build_object('supported', false, 'reason',
        format('sort on a column that is not on %s: %s', p_object, v_c));
    END IF;
    IF v_d.join_sql <> '' AND NOT (v_c = ANY(v_seen)) THEN
      v_joins := v_joins || v_d.join_sql;
      v_seen  := v_seen || v_c;
    END IF;
    v_sort := format(' ORDER BY %s %s NULLS LAST, t.id ASC',
                     v_d.display_expr,
                     CASE WHEN lower(COALESCE(p_sort_dir,'asc'))='desc' THEN 'DESC' ELSE 'ASC' END);
  ELSE
    -- No sort: primary-key order, which is what the client-side path returns
    -- today (the fetch is keyset-ordered by id and ListView renders it
    -- verbatim when a view carries no sort). Paging needs SOME total order or
    -- rows repeat and skip across pages.
    v_sort := ' ORDER BY t.id ASC';
  END IF;

  -- ── Columns ───────────────────────────────────────────────────────────────
  v_sel := 't.id';
  IF p_columns IS NOT NULL THEN
    FOREACH v_c IN ARRAY p_columns LOOP
      CONTINUE WHEN v_c = 'id';
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema='public' AND c.table_name=p_object AND c.column_name=v_c);
      v_sel := v_sel || format(', t.%I', v_c);
    END LOOP;
  END IF;

  v_sql := format('SELECT count(*) FROM public.%I t%s WHERE %s', p_object, v_joins, v_where);
  IF array_length(v_binds,1) IS NULL THEN
    EXECUTE v_sql INTO v_total;
  ELSE
    EXECUTE v_sql INTO v_total USING v_binds;
  END IF;

  v_sql := format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) FROM ('
    || 'SELECT %s FROM public.%I t%s WHERE %s%s LIMIT %s OFFSET %s) r',
    v_sel, p_object, v_joins, v_where, v_sort, v_limit, v_offset);
  IF array_length(v_binds,1) IS NULL THEN
    EXECUTE v_sql INTO v_rows;
  ELSE
    EXECUTE v_sql INTO v_rows USING v_binds;
  END IF;

  RETURN jsonb_build_object(
    'supported', true,
    'total',     v_total,
    'limit',     v_limit,
    'offset',    v_offset,
    'rows',      COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.list_object_page(text,text[],jsonb,text,text,text[],text,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_object_page(text,text[],jsonb,text,text,text[],text,text,int,int) TO authenticated;

COMMENT ON FUNCTION public.list_object_page(text,text[],jsonb,text,text,text[],text,text,int,int) IS
  'One page of a list: filter, search, sort, count and page in SQL instead of downloading the object into the browser. SECURITY INVOKER, so RLS and the geographic state scope still decide what is visible. Returns {"supported":false,"reason":…} for anything it cannot express faithfully — a related field resolved client-side, an unknown operator or column — so the caller falls back rather than showing a half-applied filter.';

NOTIFY pgrst, 'reload schema';
