-- =============================================================================
-- A list page sorts on the COLUMN, not on a cast of it.
--
-- list_object_page built its ORDER BY from display_expr, which casts a plain
-- text column with ::text. An index on the column does not match the cast
-- expression, so the planner could not use idx_properties_list_order and sorted
-- all 16,665 rows to return 100 of them. Measured on production:
--
--   ORDER BY t.property_name::text  ->  286 ms   (full sort, then discard)
--   ORDER BY t.property_name        ->  5.6 ms   (index scan, LIMIT stops it)
--
-- native_expr is the same column without the cast. For a picklist, user or
-- lookup column display_expr and native_expr are the SAME joined column, so
-- nothing changes for those.
--
-- ONE VISIBLE CONSEQUENCE, WRITTEN DOWN BECAUSE IT IS A BEHAVIOUR CHANGE: a
-- number or a date now sorts as itself. The browser sorted every column as
-- text through Intl.Collator, so 10 sorted before 9. Sorting a number
-- numerically is the correction, not a regression, but somebody will notice it
-- and should be able to find out why here.
--
-- Patched against the deployed definition rather than re-emitted: the function
-- is 200 lines of query building that has nothing to do with this change, and
-- retyping it to alter one expression is how a working function gets corrupted.
-- The migration RAISES if the sort clause is not in the shape it expects, and
-- again afterwards if the cast is still there.
-- =============================================================================
DO $$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='list_object_page';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'list_object_page not found';
  END IF;

  IF position('ORDER BY %s %s NULLS LAST, t.id ASC'', v_d.display_expr,' IN v_src) = 0 THEN
    RAISE EXCEPTION 'the sort clause is not in the shape this migration patches';
  END IF;

  v_new := replace(v_src,
    'ORDER BY %s %s NULLS LAST, t.id ASC'', v_d.display_expr,',
    'ORDER BY %s %s NULLS LAST, t.id ASC'', v_d.native_expr,');

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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='list_object_page'
               AND p.prosrc LIKE '%NULLS LAST, t.id ASC'', v_d.display_expr%') THEN
    RAISE EXCEPTION 'the sort still uses the cast expression';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
