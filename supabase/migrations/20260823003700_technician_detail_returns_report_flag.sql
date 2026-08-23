-- ---------------------------------------------------------------------------
-- LEAP Pad needs to know which photos are already in the final report
--
-- Nicholas, 2026-08-22: "I want to make sure that we can add photos to the
-- report on this screen as well as within the work steps."
--
-- The report-inclusion flag has existed since the photo pipeline shipped, but
-- only the desktop gallery could see or set it. work_order_detail_for_technician
-- returns each step's photos without include_in_final_report, so the field app
-- had nothing to render a flag from — a technician standing in the attic, who
-- knows better than anyone which shot proves the work, could not mark it.
--
-- Rewritten in place rather than restated: the function is 9k characters and
-- retyping it to add one key invites a transcription error. This asserts the
-- anchor appears exactly once, splices the key in, and re-creates the function.
-- CREATE OR REPLACE preserves the existing grants.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_def    text;
  v_anchor text := E'\'taken_at\', p2.taken_at\n';
  v_new    text := E'\'taken_at\', p2.taken_at,\n                                     \'include_in_final_report\', p2.include_in_final_report\n';
  v_hits   integer;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'work_order_detail_for_technician';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'work_order_detail_for_technician not found';
  END IF;

  IF position('include_in_final_report' in v_def) > 0 THEN
    RAISE NOTICE 'include_in_final_report already returned; nothing to do.';
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected exactly one photo taken_at anchor, found %', v_hits;
  END IF;

  EXECUTE replace(v_def, v_anchor, v_new);
END $do$;

NOTIFY pgrst, 'reload schema';
