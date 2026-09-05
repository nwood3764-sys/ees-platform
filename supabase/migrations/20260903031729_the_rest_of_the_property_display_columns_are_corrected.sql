-- ===========================================================================
-- The rest of the property display columns are corrected.
--
-- The remaining nine registered columns on properties, after property_aka_name
-- went in the previous migration.  Split from it for one reason only: at ~490
-- rows/second on a 100 MB heap with 6 KB rows and 31 indexes, the two together
-- are minutes of writing.
--
--   property_lihtc_project_name    9,052 shouting
--   property_std_address           5,951
--   property_hud_owner_org         1,108
--   property_ph_project_name         952
--   property_usda_management_name  2,502
--   property_hud_owner_city          270
--   property_hud_owner_address       213  <- the column behind the reported line
--   property_ph_authority_name        90
--   property_mf_hub_name               1
--
-- Untouched, deliberately: property_street and property_city, which
-- normalize_property_address() has owned since the importers landed, and every
-- property_*_raw_* column, which is the import's own transcript and the
-- evidence a match was made correctly.
-- ===========================================================================
do $$
DECLARE
  v_cols constant text[] := array[
    'property_lihtc_project_name','property_std_address','property_hud_owner_org',
    'property_hud_owner_address','property_hud_owner_city','property_ph_project_name',
    'property_ph_authority_name','property_usda_management_name','property_mf_hub_name'];
  v_rows  bigint;
  v_bad   text;
  v_probe text;
BEGIN
  PERFORM set_config('statement_timeout', '900s', true);

  v_rows := public.run_text_case_backfill(array['properties'], v_cols);
  RAISE NOTICE 'text case: % property values rewritten', v_rows;

  -- Re-checked with NO prefilter, every row.
  SELECT string_agg(finding || ' -- ' || detail, '; ') INTO v_bad
  FROM public.verify_text_case_normalization(array['properties'], v_cols);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'property text case backfill incomplete: %', v_bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.text_case_normalization_log
                 WHERE tcnl_object = 'properties' AND tcnl_column = ANY (v_cols)) THEN
    RAISE EXCEPTION 'the property backfill logged nothing -- it is not reversible';
  END IF;

  -- The property behind the reported document, and a good case in its own
  -- right: HUD put a whole address in the street column, WAUKESHA has to come
  -- down, and WI has to stay up.
  SELECT property_hud_owner_address INTO v_probe FROM public.properties
   WHERE property_record_number = 'PROP-07530';
  IF v_probe IS DISTINCT FROM 'PO Box 304, Waukesha, WI 53187' THEN
    RAISE EXCEPTION 'PROP-07530 HUD owner address reads %L', v_probe;
  END IF;

  IF EXISTS (SELECT 1 FROM public.text_case_normalization_log
             WHERE tcnl_object = 'properties'
               AND tcnl_column IN ('property_street','property_city')) THEN
    RAISE EXCEPTION 'the casing backfill wrote to a column normalize_property_address() owns';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger tg
             JOIN pg_class c ON c.oid = tg.tgrelid AND c.relnamespace = 'public'::regnamespace
             WHERE NOT tg.tgisinternal AND tg.tgenabled = 'D' AND c.relname = 'properties') THEN
    RAISE EXCEPTION 'the casing backfill left a trigger disabled on properties';
  END IF;
END $$;
