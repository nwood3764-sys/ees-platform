-- ---------------------------------------------------------------------------
-- Retire Close Date from opportunities.
--
-- Nicholas, 2026-08-26, from the New Opportunity pop-up: "on new opportunities
-- for this one, we don't use closed dates. Get rid of that fucking field
-- altogether, and it definitely should not be required."
--
-- Close Date is a Salesforce sales-pipeline field. EES does not run a sales
-- pipeline on opportunities -- an opportunity is a property's enrolment in a
-- program, and it ends when the program's stages end, on a date the stages
-- already record. The field has been carried since the baseline and is
-- populated on ZERO of the 101 live opportunities, while four active layouts
-- marked it REQUIRED, so the create pop-up demanded a date nobody has ever had.
--
-- It came off the page layouts, which is where "required" was declared -- the
-- column itself is nullable, so nothing in the database ever needed it. The
-- physical column is dropped in a follow-up migration once the deployed bundle
-- has stopped selecting it; dropping it in the same breath as this change would
-- 400 the opportunity lists for anyone with a tab open during the deploy.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_rows integer; v_left integer;
BEGIN
  UPDATE public.page_layout_widgets w
     SET widget_config = jsonb_set(
           w.widget_config,
           '{fields}',
           COALESCE((
             SELECT jsonb_agg(f ORDER BY ord)
               FROM jsonb_array_elements(w.widget_config -> 'fields') WITH ORDINALITY AS t(f, ord)
              WHERE f ->> 'name' <> 'opportunity_close_date'
           ), '[]'::jsonb)
         )
   WHERE w.widget_config ? 'fields'
     AND w.widget_config -> 'fields' @> '[{"name": "opportunity_close_date"}]'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT count(*) INTO v_left
    FROM public.page_layout_widgets
   WHERE widget_config::text LIKE '%opportunity_close_date%';

  IF v_left > 0 THEN
    RAISE EXCEPTION 'Close Date still referenced by % layout widget(s) after the strip.', v_left;
  END IF;

  RAISE NOTICE 'Removed Close Date from % layout widget(s).', v_rows;
END $$;
