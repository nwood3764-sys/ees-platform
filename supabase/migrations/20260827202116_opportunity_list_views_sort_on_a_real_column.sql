-- =============================================================================
-- Three saved opportunity list views still sort on a column that no longer
-- exists.
--
-- `opportunities.close_date` was dropped on 2026-08-26 (it was a sales-pipeline
-- field EES does not use: populated on none of the live opportunities while
-- four layouts marked it required). Three saved views were left pointing at it
-- — "All Opportunities", "NC - IRA - MF" and "All".
--
-- The list engine skips a sort whose column it cannot resolve, so nothing
-- errored: the views simply came back in no particular order while the chip
-- above the list read "Sort: close_date ↑", which is worse than an error
-- because it states an ordering the rows do not have. Visible in Nicholas's
-- screenshot of the scoped opportunities list, 2026-08-27.
--
-- Repointed to `opportunity_updated_at` descending — most recently touched
-- first — which is the sort the platform's other opportunity view already
-- uses, and a real column.
-- =============================================================================

DO $$
DECLARE
  v_updated int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'opportunities'
       AND column_name = 'close_date'
  ) THEN
    RAISE EXCEPTION 'opportunities.close_date still exists — this migration assumes it was dropped';
  END IF;

  UPDATE public.saved_list_views
     SET list_view_sort_field     = 'opportunity_updated_at',
         list_view_sort_direction = 'desc'
   WHERE list_view_object = 'opportunities'
     AND list_view_sort_field = 'close_date';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'repointed % opportunity list view(s) off close_date', v_updated;

  IF EXISTS (
    SELECT 1 FROM public.saved_list_views
     WHERE list_view_object = 'opportunities' AND list_view_sort_field = 'close_date'
  ) THEN
    RAISE EXCEPTION 'a saved opportunity list view still sorts on close_date';
  END IF;
END
$$;
