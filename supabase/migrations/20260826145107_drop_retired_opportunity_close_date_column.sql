-- Drop the retired opportunity_close_date column.
-- Split from 20260826144126 on purpose: the column had to stop being SELECTed
-- by the deployed bundle before it could be dropped, or the Outreach,
-- Qualification and Project Planning opportunity lists would 400 for anyone
-- with a tab open between the migration and the deploy. Applied after the
-- production deploy of c0cd49e was verified live.
-- Dependency sweep before dropping (all zero): populated rows, page layouts,
-- field_metadata, field_permissions, report filters/groupings/calculated
-- fields, saved list views, dashboard widgets, database functions, views and
-- policies. The only code reference was fetchOpportunities in outreachService,
-- removed in the same pull request.
DO $$
DECLARE v_rows integer; v_refs integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='opportunities'
                    AND column_name='opportunity_close_date') THEN
    RAISE NOTICE 'opportunity_close_date already dropped.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.opportunities WHERE opportunity_close_date IS NOT NULL' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'Refusing to drop opportunity_close_date: % row(s) carry a value.', v_rows;
  END IF;

  SELECT count(*) INTO v_refs FROM public.page_layout_widgets
   WHERE widget_config::text LIKE '%opportunity_close_date%';
  IF v_refs > 0 THEN
    RAISE EXCEPTION 'Refusing to drop opportunity_close_date: still on % layout widget(s).', v_refs;
  END IF;

  SELECT count(*) INTO v_refs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc LIKE '%opportunity_close_date%';
  IF v_refs > 0 THEN
    RAISE EXCEPTION 'Refusing to drop opportunity_close_date: referenced by % function(s).', v_refs;
  END IF;

  ALTER TABLE public.opportunities DROP COLUMN opportunity_close_date;
  RAISE NOTICE 'Dropped opportunities.opportunity_close_date.';
END $$;

NOTIFY pgrst, 'reload schema';
