-- Every technician-created work order has been FAILING since 2026-09-03.
--
-- `enforce_service_appointment_is_for_an_assessment` (shipped that morning)
-- refuses a service appointment on any work order whose work type is not an
-- assessment or an audit. Four functions still book one unconditionally:
--
--   create_technician_work_order               LEAP Pad "Create Work Order"
--   create_technician_work_order_for_property  LEAP Pad ad hoc create
--   ensure_daily_building_access_work_order    trigger: the day's access stop
--   open_monthly_vehicle_equipment_checks      the monthly fleet opener
--
-- So the whole Create Work Order menu -- Building Access, Material Delivery,
-- the Monthly Vehicle Equipment and Documents Check -- raises P0001 and creates
-- nothing; and because the access-stop trigger fires on
-- service_appointment_assignments, PUTTING A CREW MEMBER ON AN ASSESSMENT
-- APPOINTMENT fails too on any work order that carries a building. Reproduced
-- on prod in a rolled-back transaction, impersonating a Project Site Lead
-- under RLS:
--
--   create_technician_work_order(<an assessment WO>, WT-00080)
--     -> ERROR: A service appointment is only for an assessment. WO-00250 is a
--        "Building Access - Unlock and Lock" work order ...
--
-- The rule is right and is untouched. What was left behind is these four
-- callers.
--
-- THE RULING THEY NOW FOLLOW (Nicholas, 2026-09-03): a technician's day is a
-- list of WORK ORDERS, and a work order reaches its technician on its own
-- Assigned Technician + Scheduled Start Date alone. `my_service_appointments`
-- already selects FROM work_orders and joins an appointment laterally, so
-- stamping those two columns puts the new stop on the right person's day --
-- with no appointment, no customer carried into the notification pipeline, and
-- nothing gating whether the job is shown.
--
-- Deliberately unchanged: create_assessment_work_order and
-- create_mf_building_assessment_work_order. Those create ASSESSMENT work
-- orders, which is exactly what an appointment is for.
--
-- PATCHED IN PLACE, NOT RE-EMITTED. create_technician_work_order_for_property
-- is 130 lines of building/unit/project resolution that has nothing to do with
-- this change; retyping working code to delete two statements from it is how
-- one gets corrupted (the 2026-09-03 rule). Each function is read back from the
-- catalog, exactly one anchored slice is cut, and the migration RAISES if an
-- anchor is missing or if the slice it was about to remove does not in fact
-- contain the appointment insert. The three now-unused locals (v_sa,
-- v_sa_status, v_new_sa_id) are left declared: they are inert, and a line not
-- touched is a line that cannot be broken.

DO $patch$
DECLARE
  -- fn, anchor_after (kept, the cut starts right after it),
  -- anchor_before (kept, the cut ends right before it), replacement
  v_case   record;
  v_def    text;
  v_cut    text;
  v_a      integer;
  v_b      integer;
  v_newdef text;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      -- 1. LEAP Pad -> Create Work Order, from a stop the technician is on.
      ('public.create_technician_work_order(uuid,uuid)',
       'RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;',
       '  RETURN QUERY SELECT v_new, v_rn, ''success'',',
       E'\n\n  -- The two columns a technician''s day is built from. There is no\n  -- appointment: nobody is being visited, so there is no customer to\n  -- confirm, remind, or tell that a technician is on the way.\n  UPDATE public.work_orders\n     SET assigned_technician_id = v_actor,\n         work_order_scheduled_start_date = (now() AT TIME ZONE ''America/Chicago'')::date,\n         work_order_scheduled_start_time = (now() AT TIME ZONE ''America/Chicago'')::time\n   WHERE id = v_new;\n\n'),

      -- 2. LEAP Pad -> the ad hoc path ("Property is not in this list").
      ('public.create_technician_work_order_for_property(uuid,uuid,uuid,uuid,text,uuid,boolean)',
       'RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;',
       '  IF array_length(v_created, 1) > 0 THEN',
       E'\n\n  -- On the creating technician''s day, by the work order''s own schedule.\n  UPDATE public.work_orders\n     SET assigned_technician_id = v_actor,\n         work_order_scheduled_start_date = (now() AT TIME ZONE ''America/Chicago'')::date,\n         work_order_scheduled_start_time = (now() AT TIME ZONE ''America/Chicago'')::time\n   WHERE id = v_new;\n\n'),

      -- 3. The day's building-access stop. This fires when somebody is put on
      --    an ASSESSMENT appointment, which is still legitimate -- what it may
      --    no longer do is book an appointment for the access stop it opens.
      --    It already stamps the scheduled date and time from the assessment
      --    visit; it now also names the technician who was just assigned.
      ('public.ensure_daily_building_access_work_order()',
       'RETURNING id INTO v_new_wo_id;',
       E'  RETURN NEW;\nEND;',
       E'\n\n  -- The access stop belongs to whoever was just put on the day.\n  UPDATE public.work_orders\n     SET assigned_technician_id = NEW.saa_user_id\n   WHERE id = v_new_wo_id;\n\n'),

      -- 4. The monthly fleet opener. A fleet check has no property and no
      --    customer; it never needed an appointment to begin with.
      ('public.open_monthly_vehicle_equipment_checks(date)',
       'RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;',
       '    RETURN QUERY SELECT v_v.vehicle_record_number, v_rn, ''created'',',
       E'\n\n    -- Owned by, and on the day of, the person who has to do it.\n    UPDATE public.work_orders\n       SET assigned_technician_id = v_owner,\n           work_order_scheduled_start_date = v_month,\n           work_order_scheduled_start_time = TIME ''08:00''\n     WHERE id = v_new;\n\n')
    ) AS t(fn, anchor_after, anchor_before, replacement)
  LOOP
    v_def := pg_get_functiondef(v_case.fn::regprocedure);

    v_a := position(v_case.anchor_after IN v_def);
    IF v_a = 0 THEN
      RAISE EXCEPTION 'Could not find the insert anchor in % — refusing to guess where to cut.', v_case.fn;
    END IF;
    v_a := v_a + length(v_case.anchor_after);

    v_b := position(v_case.anchor_before IN substr(v_def, v_a)) ;
    IF v_b = 0 THEN
      RAISE EXCEPTION 'Could not find the tail anchor in % — refusing to guess where to stop.', v_case.fn;
    END IF;
    v_b := v_a + v_b - 1;

    v_cut := substr(v_def, v_a, v_b - v_a);
    IF v_cut NOT ILIKE '%INSERT INTO public.service_appointments%' THEN
      RAISE EXCEPTION 'The slice about to be removed from % does not contain the appointment insert — the anchors have drifted.', v_case.fn;
    END IF;

    v_newdef := left(v_def, v_a - 1) || v_case.replacement || substr(v_def, v_b);

    IF v_newdef ILIKE '%INSERT INTO public.service_appointments%' THEN
      RAISE EXCEPTION '% still books an appointment after the patch.', v_case.fn;
    END IF;
    IF v_newdef ILIKE '%INSERT INTO public.service_appointment_assignments%' THEN
      RAISE EXCEPTION '% still writes an appointment assignment after the patch.', v_case.fn;
    END IF;

    EXECUTE v_newdef;
  END LOOP;
END
$patch$;

NOTIFY pgrst, 'reload schema';

-- Assert what is deployed, rather than what was intended. A body that still
-- inserts an appointment IS the defect, so that is what is checked -- and
-- separately that the two columns a technician's day is built from are written.
DO $verify$
DECLARE
  v_name text;
  v_src  text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'create_technician_work_order',
    'create_technician_work_order_for_property',
    'ensure_daily_building_access_work_order',
    'open_monthly_vehicle_equipment_checks'
  ] LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_src IS NULL THEN
      RAISE EXCEPTION '% is missing.', v_name;
    END IF;
    IF v_src ILIKE '%INSERT INTO public.service_appointments%' THEN
      RAISE EXCEPTION '% still books a service appointment — it will keep raising on every non-assessment work order.', v_name;
    END IF;
    IF v_src NOT ILIKE '%assigned_technician_id%' THEN
      RAISE EXCEPTION '% names no assigned technician — the work order it creates would reach nobody.', v_name;
    END IF;
  END LOOP;

  -- The rule itself is untouched, and the assessment creators still use it.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public'
                    AND p.proname='enforce_service_appointment_is_for_an_assessment') THEN
    RAISE EXCEPTION 'enforce_service_appointment_is_for_an_assessment is gone — it is the rule these callers were fixed to respect.';
  END IF;
  FOREACH v_name IN ARRAY ARRAY['create_assessment_work_order','create_mf_building_assessment_work_order'] LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname = v_name;
    IF v_src NOT ILIKE '%INSERT INTO public.service_appointments%' THEN
      RAISE EXCEPTION '% no longer books an appointment — an assessment IS what an appointment is for.', v_name;
    END IF;
  END LOOP;
END
$verify$;
