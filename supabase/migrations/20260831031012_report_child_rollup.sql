-- Reporting on an object's CHILDREN, without changing what a row is.
--
-- Nicholas, 2026-08-31: "If I select a building as my primary object, for
-- example, I need to go to all of its children, all of its grandparents, any of
-- its cousins sideways, everything."
--
-- The report field picker walked outgoing foreign keys only — parents, and
-- their parents. Nothing that points AT the object was reachable: a building's
-- units, its work orders, its assessments. The reason it was never built is
-- real: a parent with twelve children is not one row any more, so a naive join
-- changes what every existing report means.
--
-- This is the half that does NOT change the row: an aggregate over the
-- children, carried on the parent's own row — "Units", "Sum of Square Feet",
-- "Latest Assessment Date". One query per roll-up, keyed by the parent id, so a
-- report of 500 buildings costs one extra round trip per roll-up column rather
-- than one per row. (One row PER CHILD — Salesforce's "A with B" report type —
-- is the other half, and is built separately.)
--
-- SECURITY INVOKER, deliberately: an aggregate is a read of the child records,
-- and it must see exactly what the caller may see. A definer function here
-- would count rows a state-scoped user is forbidden — and leak the size of what
-- they cannot read.
--
-- Identifiers are checked against the catalog, never interpolated raw: the
-- table and column must exist in `public`, and the aggregate must be one of
-- five. Anything else raises rather than reaching EXECUTE.

CREATE OR REPLACE FUNCTION public.report_child_rollup(
  p_child_table   text,
  p_fk_column     text,
  p_parent_ids    uuid[],
  p_agg           text,
  p_value_column  text DEFAULT NULL
)
RETURNS TABLE (parent_id uuid, value jsonb)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_agg        text;
  v_soft_del   text;
  v_value_expr text;
  v_sql        text;
BEGIN
  IF p_parent_ids IS NULL OR array_length(p_parent_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  v_agg := lower(btrim(coalesce(p_agg, 'count')));
  IF v_agg NOT IN ('count', 'sum', 'avg', 'min', 'max') THEN
    RAISE EXCEPTION 'Unsupported roll-up aggregate: %', p_agg USING ERRCODE = '22023';
  END IF;

  -- The child table must be a real table in public.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = p_child_table
  ) THEN
    RAISE EXCEPTION 'No such object: %', p_child_table USING ERRCODE = '42P01';
  END IF;

  -- The foreign-key column must exist on it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = p_child_table AND column_name = p_fk_column
  ) THEN
    RAISE EXCEPTION '% has no column %', p_child_table, p_fk_column USING ERRCODE = '42703';
  END IF;

  -- COUNT needs no column; every other aggregate needs one that exists.
  IF v_agg = 'count' THEN
    v_value_expr := '*';
  ELSE
    IF p_value_column IS NULL OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = p_child_table AND column_name = p_value_column
    ) THEN
      RAISE EXCEPTION '% has no column % to %', p_child_table, coalesce(p_value_column, '(none)'), v_agg
        USING ERRCODE = '42703';
    END IF;
    v_value_expr := quote_ident(p_value_column);
  END IF;

  -- Soft-deleted children are not children. Tables carry either the bare
  -- `is_deleted` or a prefixed spelling (`unit_is_deleted`); a table with
  -- neither is counted whole.
  SELECT column_name INTO v_soft_del
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = p_child_table
    AND data_type = 'boolean'
    AND (column_name = 'is_deleted' OR column_name LIKE '%\_is\_deleted')
  ORDER BY (column_name = 'is_deleted') DESC
  LIMIT 1;

  v_sql := format(
    'SELECT %1$I::uuid AS parent_id, to_jsonb(%2$s(%3$s)) AS value
       FROM public.%4$I
      WHERE %1$I = ANY($1) %5$s
      GROUP BY %1$I',
    p_fk_column,
    v_agg,
    v_value_expr,
    p_child_table,
    CASE WHEN v_soft_del IS NULL THEN '' ELSE format('AND coalesce(%I, false) = false', v_soft_del) END
  );

  RETURN QUERY EXECUTE v_sql USING p_parent_ids;
END $function$;

REVOKE ALL ON FUNCTION public.report_child_rollup(text, text, uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_child_rollup(text, text, uuid[], text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
