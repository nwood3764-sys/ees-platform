-- Caught by RUNNING the previous migration's change, not by reading it.
--
-- `ensure_daily_building_access_work_order` decided "this building already has
-- its access stop today" by looking for a SERVICE APPOINTMENT on that building,
-- that day, of the access work type. The previous migration stopped that
-- function from booking one -- so the marker it deduped on no longer exists,
-- and putting a SECOND crew member on the same assessment visit opened a SECOND
-- access work order. Reproduced on prod in a rolled-back transaction: two
-- assignments on one appointment produced WO-00275 and WO-00276, same building,
-- same day.
--
-- The dedupe now asks the work order itself, which is where the day has lived
-- since the previous migration: an access work order for this building whose
-- own Scheduled Start Date is that day. The old appointment test is KEPT as a
-- second arm, because the 19 access work orders opened before this change were
-- marked by an appointment as well -- so history is still recognised and can
-- never be duplicated. The check can only ever find MORE rows than before,
-- never fewer.
--
-- Patched in place against the deployed definition, with the anchors asserted.

DO $patch$
DECLARE
  v_fn     text := 'public.ensure_daily_building_access_work_order()';
  v_after  text := E'hashtext(''daily_building_access:'' || v_wo.building_id::text || '':'' || v_day::text)\n  );';
  v_before text := '  SELECT id INTO v_wo_status FROM public.picklist_values';
  v_repl   text := E'\n\n  -- Already opened for this building today? Ask the WORK ORDER, which is\n  -- what carries the day now. The appointment arm keeps recognising the rows\n  -- opened before access stops stopped booking one.\n  IF EXISTS (\n    SELECT 1\n    FROM public.work_orders wo2\n    WHERE wo2.work_order_is_deleted IS NOT TRUE\n      AND wo2.building_id = v_wo.building_id\n      AND wo2.work_type_id = v_access_type.id\n      AND (\n        wo2.work_order_scheduled_start_date = v_day\n        OR EXISTS (\n          SELECT 1 FROM public.service_appointments sa2\n           WHERE sa2.work_order_id = wo2.id\n             AND sa2.sa_is_deleted IS NOT TRUE\n             AND (sa2.sa_scheduled_start_time AT TIME ZONE ''America/Chicago'')::date = v_day\n        )\n      )\n  ) THEN\n    RETURN NEW;\n  END IF;\n\n';
  v_def    text;
  v_cut    text;
  v_a      integer;
  v_b      integer;
  v_newdef text;
BEGIN
  v_def := pg_get_functiondef(v_fn::regprocedure);

  v_a := position(v_after IN v_def);
  IF v_a = 0 THEN
    RAISE EXCEPTION 'Could not find the advisory-lock anchor — refusing to guess where the dedupe starts.';
  END IF;
  v_a := v_a + length(v_after);

  v_b := position(v_before IN substr(v_def, v_a));
  IF v_b = 0 THEN
    RAISE EXCEPTION 'Could not find the tail anchor — refusing to guess where the dedupe ends.';
  END IF;
  v_b := v_a + v_b - 1;

  v_cut := substr(v_def, v_a, v_b - v_a);
  IF v_cut NOT ILIKE '%FROM public.service_appointments sa2%' THEN
    RAISE EXCEPTION 'The slice about to be replaced is not the appointment-based dedupe — the anchors have drifted.';
  END IF;

  v_newdef := left(v_def, v_a - 1) || v_repl || substr(v_def, v_b);
  EXECUTE v_newdef;
END
$patch$;

NOTIFY pgrst, 'reload schema';

DO $verify$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='ensure_daily_building_access_work_order';
  IF v_src NOT ILIKE '%wo2.work_order_scheduled_start_date = v_day%' THEN
    RAISE EXCEPTION 'The access stop is still deduped only by an appointment it no longer books — a second crew member would open a second stop.';
  END IF;
  IF v_src NOT ILIKE '%sa2.sa_scheduled_start_time%' THEN
    RAISE EXCEPTION 'The legacy appointment arm is gone — the access stops opened before today would stop being recognised.';
  END IF;
  IF v_src ILIKE '%INSERT INTO public.service_appointments%' THEN
    RAISE EXCEPTION 'The access stop books an appointment again.';
  END IF;
END
$verify$;
