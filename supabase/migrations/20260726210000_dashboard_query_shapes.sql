-- =============================================================================
-- Dashboard rehaul Phase B: the query shapes that unlock the expanded widget
-- library (docs/leap-dashboard-rehaul.md §5). Three new SECURITY INVOKER RPCs
-- alongside report_aggregate, sharing its exact semantics (soft-delete filter,
-- picklist/FK label resolution, {col,op,val} filter shape) via helpers:
--
--   report_aggregate_2d     category × series pivot  → stacked/clustered bars,
--                           100% stacked, heatmap, area-by-series, matrix
--   report_aggregate_time   date_trunc time buckets  → real time-axis line/area,
--                           sparklines, KPI trends
--   report_aggregate_single one aggregate, no group  → metric/gauge/KPI without
--                           dragging every report row to the browser
--
-- All are RLS-respecting (SECURITY INVOKER); anon is revoked.
-- =============================================================================

-- ── Shared helpers ───────────────────────────────────────────────────────────

-- WHERE clause: soft-delete guard + widget/dashboard filters, identical to the
-- inline logic in report_aggregate.
CREATE OR REPLACE FUNCTION public._report_agg_where(p_table text, p_filters jsonb)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_where    text := ' WHERE true';
  v_soft_col text;
  v_filter   jsonb;
  v_col      text;
  v_op       text;
  v_val      jsonb;
BEGIN
  SELECT (ees_table_metadata(p_table)->>'is_deleted_column') INTO v_soft_col;
  IF v_soft_col IS NOT NULL THEN
    v_where := v_where || format(' AND t.%I = false', v_soft_col);
  END IF;

  FOR v_filter IN SELECT * FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb))
  LOOP
    v_col := v_filter->>'col';
    v_op  := COALESCE(v_filter->>'op', 'equals');
    v_val := v_filter->'val';
    IF v_col IS NULL OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = p_table AND column_name = v_col
    ) THEN
      CONTINUE;
    END IF;
    v_where := v_where || CASE v_op
      WHEN 'equals'      THEN format(' AND t.%I = %L',  v_col, v_val#>>'{}')
      WHEN 'not_equals'  THEN format(' AND t.%I <> %L', v_col, v_val#>>'{}')
      WHEN 'gt'          THEN format(' AND t.%I > %L',  v_col, v_val#>>'{}')
      WHEN 'lt'          THEN format(' AND t.%I < %L',  v_col, v_val#>>'{}')
      WHEN 'gte'         THEN format(' AND t.%I >= %L', v_col, v_val#>>'{}')
      WHEN 'lte'         THEN format(' AND t.%I <= %L', v_col, v_val#>>'{}')
      WHEN 'is_null'     THEN format(' AND t.%I IS NULL', v_col)
      WHEN 'is_not_null' THEN format(' AND t.%I IS NOT NULL', v_col)
      WHEN 'in'          THEN format(' AND t.%I = ANY(%L)', v_col,
                              (SELECT array_agg(x#>>'{}') FROM jsonb_array_elements(v_val) x))
      ELSE ''
    END;
  END LOOP;

  RETURN v_where;
END;
$$;

-- Label resolution for a grouping column: picklist FK → picklist label,
-- other FK → referenced table's *_name column, else the raw value. The alias
-- parameter lets one query resolve two different columns without join clashes.
CREATE OR REPLACE FUNCTION public._report_agg_label(p_table text, p_col text, p_alias text)
RETURNS TABLE(join_sql text, label_expr text)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_ref_table text;
  v_name_col  text;
BEGIN
  join_sql   := '';
  label_expr := format('COALESCE(t.%I::text, ''—'')', p_col);

  SELECT cl2.relname INTO v_ref_table
  FROM pg_constraint con
  JOIN pg_class cl  ON cl.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  JOIN pg_class cl2 ON cl2.oid = con.confrelid
  WHERE con.contype = 'f' AND cl.relname = p_table AND att.attname = p_col
  LIMIT 1;

  IF v_ref_table = 'picklist_values' THEN
    join_sql   := format(' LEFT JOIN picklist_values %I ON %I.id = t.%I', p_alias, p_alias, p_col);
    label_expr := format('COALESCE(%I.picklist_label, %I.picklist_value, ''—'')', p_alias, p_alias);
  ELSIF v_ref_table IS NOT NULL THEN
    SELECT column_name INTO v_name_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_ref_table
      AND column_name LIKE '%\_name' ESCAPE '\'
    ORDER BY (column_name = v_ref_table || '_name') DESC, column_name
    LIMIT 1;
    IF v_name_col IS NOT NULL THEN
      join_sql   := format(' LEFT JOIN %I %I ON %I.id = t.%I', v_ref_table, p_alias, p_alias, p_col);
      label_expr := format('COALESCE(%I.%I, ''—'')', p_alias, v_name_col);
    END IF;
  END IF;

  RETURN NEXT;
END;
$$;

-- Measure expression with column validation.
CREATE OR REPLACE FUNCTION public._report_agg_measure(p_table text, p_measure_type text, p_measure_field text)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF p_measure_type = 'count' OR p_measure_field IS NULL THEN
    RETURN 'COUNT(*)::numeric';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = p_table
                   AND column_name = p_measure_field) THEN
    RAISE EXCEPTION 'Unknown measure column %.%', p_table, p_measure_field;
  END IF;
  RETURN CASE lower(p_measure_type)
    WHEN 'sum' THEN format('COALESCE(SUM(t.%I),0)::numeric', p_measure_field)
    WHEN 'avg' THEN format('COALESCE(AVG(t.%I),0)::numeric', p_measure_field)
    WHEN 'min' THEN format('MIN(t.%I)::numeric', p_measure_field)
    WHEN 'max' THEN format('MAX(t.%I)::numeric', p_measure_field)
    ELSE 'COUNT(*)::numeric'
  END;
END;
$$;

-- ── report_aggregate_2d: category × series pivot ─────────────────────────────
CREATE OR REPLACE FUNCTION public.report_aggregate_2d(
  p_primary_object text,
  p_group_col      text,
  p_series_col     text,
  p_measure_type   text    DEFAULT 'count',
  p_measure_field  text    DEFAULT NULL,
  p_filters        jsonb   DEFAULT '[]'::jsonb,
  p_limit          integer DEFAULT 500
)
RETURNS TABLE(label text, series text, value numeric, raw_value text, raw_series text)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_g   record;
  v_s   record;
  v_sql text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = p_primary_object) THEN
    RAISE EXCEPTION 'Unknown object: %', p_primary_object;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = p_primary_object AND column_name = p_group_col) THEN
    RAISE EXCEPTION 'Unknown column %.%', p_primary_object, p_group_col;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = p_primary_object AND column_name = p_series_col) THEN
    RAISE EXCEPTION 'Unknown column %.%', p_primary_object, p_series_col;
  END IF;

  SELECT * INTO v_g FROM _report_agg_label(p_primary_object, p_group_col,  'lg');
  SELECT * INTO v_s FROM _report_agg_label(p_primary_object, p_series_col, 'ls');

  v_sql := format(
    'SELECT label, series, value, raw_value, raw_series FROM ('
    || 'SELECT g.*, SUM(g.value) OVER (PARTITION BY g.label) AS grp_total FROM ('
    || 'SELECT %s AS label, %s AS series, %s AS value, %I::text AS raw_value, %I::text AS raw_series '
    || 'FROM %I t%s%s%s GROUP BY 1, 2, 4, 5'
    || ') g) x ORDER BY grp_total DESC, label, value DESC LIMIT %s',
    v_g.label_expr, v_s.label_expr,
    _report_agg_measure(p_primary_object, p_measure_type, p_measure_field),
    p_group_col, p_series_col,
    p_primary_object, v_g.join_sql, v_s.join_sql,
    _report_agg_where(p_primary_object, p_filters),
    GREATEST(COALESCE(p_limit, 500), 1)
  );

  RETURN QUERY EXECUTE v_sql;
END;
$$;

-- ── report_aggregate_time: date_trunc buckets, optional series ───────────────
CREATE OR REPLACE FUNCTION public.report_aggregate_time(
  p_primary_object text,
  p_date_col       text,
  p_grain          text    DEFAULT 'month',
  p_measure_type   text    DEFAULT 'count',
  p_measure_field  text    DEFAULT NULL,
  p_filters        jsonb   DEFAULT '[]'::jsonb,
  p_series_col     text    DEFAULT NULL,
  p_limit          integer DEFAULT 500
)
RETURNS TABLE(bucket timestamptz, label text, series text, value numeric, raw_series text)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_type   text;
  v_s      record;
  v_fmt    text;
  v_sql    text;
  v_series_label text := 'NULL::text';
  v_series_raw   text := 'NULL::text';
  v_series_join  text := '';
BEGIN
  IF p_grain NOT IN ('day','week','month','quarter','year') THEN
    RAISE EXCEPTION 'Unknown grain: %', p_grain;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = p_primary_object) THEN
    RAISE EXCEPTION 'Unknown object: %', p_primary_object;
  END IF;
  SELECT data_type INTO v_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = p_primary_object AND column_name = p_date_col;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Unknown column %.%', p_primary_object, p_date_col;
  END IF;
  IF v_type NOT IN ('date', 'timestamp with time zone', 'timestamp without time zone') THEN
    RAISE EXCEPTION 'Column %.% is not a date/timestamp', p_primary_object, p_date_col;
  END IF;

  IF p_series_col IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = p_primary_object AND column_name = p_series_col) THEN
      RAISE EXCEPTION 'Unknown column %.%', p_primary_object, p_series_col;
    END IF;
    SELECT * INTO v_s FROM _report_agg_label(p_primary_object, p_series_col, 'ls');
    v_series_label := v_s.label_expr;
    v_series_raw   := format('%I::text', p_series_col);
    v_series_join  := v_s.join_sql;
  END IF;

  v_fmt := CASE p_grain
    WHEN 'day'     THEN 'Mon DD'
    WHEN 'week'    THEN 'Mon DD'
    WHEN 'month'   THEN 'Mon YYYY'
    WHEN 'quarter' THEN '"Q"Q YYYY'
    ELSE 'YYYY'
  END;

  v_sql := format(
    'SELECT date_trunc(%L, t.%I)::timestamptz AS bucket, '
    || 'to_char(date_trunc(%L, t.%I), %L) AS label, '
    || '%s AS series, %s AS value, %s AS raw_series '
    || 'FROM %I t%s%s AND t.%I IS NOT NULL '
    || 'GROUP BY 1, 2, 3, 5 ORDER BY 1 ASC, 3 NULLS FIRST LIMIT %s',
    p_grain, p_date_col,
    p_grain, p_date_col, v_fmt,
    v_series_label,
    _report_agg_measure(p_primary_object, p_measure_type, p_measure_field),
    v_series_raw,
    p_primary_object, v_series_join,
    _report_agg_where(p_primary_object, p_filters),
    p_date_col,
    GREATEST(COALESCE(p_limit, 500), 1)
  );

  RETURN QUERY EXECUTE v_sql;
END;
$$;

-- ── report_aggregate_single: one aggregate, no grouping ──────────────────────
CREATE OR REPLACE FUNCTION public.report_aggregate_single(
  p_primary_object text,
  p_measure_type   text  DEFAULT 'count',
  p_measure_field  text  DEFAULT NULL,
  p_filters        jsonb DEFAULT '[]'::jsonb
)
RETURNS numeric
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_sql text;
  v_out numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = p_primary_object) THEN
    RAISE EXCEPTION 'Unknown object: %', p_primary_object;
  END IF;

  v_sql := format('SELECT %s FROM %I t%s',
    _report_agg_measure(p_primary_object, p_measure_type, p_measure_field),
    p_primary_object,
    _report_agg_where(p_primary_object, p_filters)
  );

  EXECUTE v_sql INTO v_out;
  RETURN COALESCE(v_out, 0);
END;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._report_agg_where(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._report_agg_label(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._report_agg_measure(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_aggregate_2d(text, text, text, text, text, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_aggregate_time(text, text, text, text, text, jsonb, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_aggregate_single(text, text, text, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._report_agg_where(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public._report_agg_label(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._report_agg_measure(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_aggregate_2d(text, text, text, text, text, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_aggregate_time(text, text, text, text, text, jsonb, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_aggregate_single(text, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
