-- The half-shouted property names, now that the rule reaches them.
--
-- 593 property_aka_name ("333 HOLLY - The Woodlands"), 73
-- property_hud_owner_org, and the rest of the registered property columns.
-- Idempotent: rewrites only what the widened rule would still change, so a
-- replay does nothing.
do $$
DECLARE
  v_rows bigint; v_bad text;
BEGIN
  PERFORM set_config('statement_timeout', '900s', true);

  v_rows := public.run_text_case_backfill(array['properties']);
  RAISE NOTICE 'text case: % half-shouted property values rewritten', v_rows;

  -- Every registered column of every registered object, every live row, no
  -- prefilter. This is the check that has caught both of the backfill's own
  -- mistakes so far.
  SELECT string_agg(finding || ' -- ' || detail, '; ') INTO v_bad
  FROM public.verify_text_case_normalization(
    array['properties','accounts','contacts','enrollments','buildings',
          'opportunities','incentive_applications']);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'text case incomplete across the registered objects: %', v_bad;
  END IF;

  -- normalize_property_address() still owns the street and the city.
  IF EXISTS (SELECT 1 FROM public.text_case_normalization_log
             WHERE tcnl_object = 'properties'
               AND tcnl_column IN ('property_street','property_city')) THEN
    RAISE EXCEPTION 'the casing backfill wrote to a column normalize_property_address() owns';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger tg
             JOIN pg_class c ON c.oid = tg.tgrelid AND c.relnamespace = 'public'::regnamespace
             WHERE NOT tg.tgisinternal AND tg.tgenabled = 'D'
               AND c.relname IN ('properties','accounts','contacts','enrollments',
                                 'buildings','opportunities','incentive_applications')) THEN
    RAISE EXCEPTION 'the casing backfill left a trigger disabled';
  END IF;
END $$;
