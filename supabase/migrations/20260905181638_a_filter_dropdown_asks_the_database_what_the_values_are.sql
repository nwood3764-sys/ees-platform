-- =============================================================================
-- A filter dropdown asks the database what the values are.
--
-- deriveColumnOptions (src/data/objectListService.js) builds every list
-- header's filter checklist by scanning ALL loaded rows, capped at 200 distinct
-- values. It also decides whether a column filters as free text or as a
-- checklist, from whatever it happened to find. That is the load-bearing reason
-- a list cannot simply be paged: on one page of 100 rows the dropdown offers
-- only that page's values, and a column can silently change filter type between
-- pages.
--
-- This answers the same question over the WHOLE object. It reuses
-- list_column_display, so a picklist, user or lookup column offers the LABELS a
-- person sees rather than the uuids stored — the other half of why the browser
-- was doing this in the first place.
--
-- THE CAP IS RETURNED, NOT HIDDEN. `capped` says the column has more distinct
-- values than were listed, so the caller can offer a text filter rather than a
-- checklist that silently omits values. deriveColumnOptions breaks at 200 and
-- says nothing, which is precisely the behaviour worth not reproducing.
--
-- SECURITY INVOKER: the values offered are only the ones this user can see, so
-- a state-scoped user is not handed the list of states they cannot read — which
-- would leak the shape of the data through the filter UI.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_object_column_options(
  p_object text,
  p_column text,
  p_limit  int DEFAULT 200
)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_d      record;
  v_soft   text;
  v_col    text := p_column;
  v_limit  int := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_where  text := 'true';
  v_sql    text;
  v_vals   jsonb;
  v_blanks boolean;
BEGIN
  IF to_regclass('public.' || quote_ident(p_object)) IS NULL THEN
    RETURN jsonb_build_object('supported', false, 'reason', format('no such object: %s', p_object));
  END IF;

  IF v_col LIKE '%\_\_rel\_\_%' OR v_col LIKE '%\_\_name' THEN
    RETURN jsonb_build_object('supported', false, 'reason',
      format('options for a client-resolved related field: %s', v_col));
  END IF;
  IF v_col LIKE '%\_\_label' THEN v_col := left(v_col, length(v_col) - length('__label')); END IF;

  SELECT * INTO v_d FROM public.list_column_display(p_object, v_col);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('supported', false, 'reason',
      format('no such column on %s: %s', p_object, v_col));
  END IF;

  v_soft := public.list_soft_delete_column(p_object);
  IF v_soft IS NOT NULL THEN v_where := format('t.%I = false', v_soft); END IF;

  -- One extra row is fetched so "capped" can be answered honestly rather than
  -- inferred from the list being exactly full.
  v_sql := format(
    'SELECT COALESCE(jsonb_agg(v ORDER BY v), ''[]''::jsonb) FROM ('
    || 'SELECT DISTINCT %s AS v FROM public.%I t%s WHERE %s AND coalesce(btrim(%s), '''') <> '''' '
    || 'ORDER BY 1 LIMIT %s) s',
    v_d.display_expr, p_object, v_d.join_sql, v_where, v_d.display_expr, v_limit + 1);
  EXECUTE v_sql INTO v_vals;

  v_sql := format(
    'SELECT EXISTS (SELECT 1 FROM public.%I t%s WHERE %s AND coalesce(btrim(%s), '''') = '''')',
    p_object, v_d.join_sql, v_where, v_d.display_expr);
  EXECUTE v_sql INTO v_blanks;

  RETURN jsonb_build_object(
    'supported',  true,
    'kind',       v_d.kind,
    'capped',     jsonb_array_length(v_vals) > v_limit,
    'has_blanks', v_blanks,
    'values',     CASE WHEN jsonb_array_length(v_vals) > v_limit
                       THEN (SELECT jsonb_agg(x) FROM (
                              SELECT x FROM jsonb_array_elements(v_vals) x LIMIT v_limit) z)
                       ELSE v_vals END);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_object_column_options(text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_object_column_options(text,text,int) TO authenticated;

COMMENT ON FUNCTION public.list_object_column_options(text,text,int) IS
  'The distinct values a list column can be filtered on, over the WHOLE object rather than the rows that happen to be loaded, with picklist/user/lookup columns offering their labels. Reports "capped" honestly so a caller can fall back to a text filter instead of a checklist that silently omits values. SECURITY INVOKER, so a user is only offered values they can see.';

-- Controls: labels not uuids, agreement with a direct DISTINCT, and a refusal.
DO $$
DECLARE v_r jsonb;
BEGIN
  v_r := public.list_object_column_options('properties','property_status');
  IF (v_r->>'supported')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'property_status options unsupported: %', v_r->>'reason';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_r->'values') x
             WHERE x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-') THEN
    RAISE EXCEPTION 'a picklist column offered uuids instead of labels: %', v_r->'values';
  END IF;

  v_r := public.list_object_column_options('properties','property_state');
  IF (v_r->>'supported')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'property_state options unsupported';
  END IF;
  IF jsonb_array_length(v_r->'values') <> (
       SELECT count(DISTINCT property_state) FROM properties
       WHERE property_is_deleted = false AND coalesce(btrim(property_state),'') <> '') THEN
    RAISE EXCEPTION 'state options (%) do not match the table', jsonb_array_length(v_r->'values');
  END IF;

  v_r := public.list_object_column_options('properties','property_id__rel__account_name');
  IF (v_r->>'supported')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'a related field was not refused';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
