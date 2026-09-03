-- Dump Trailer Disposal Run.
--
-- Nicholas: "creating a work order for taking a dump trailer to the landfill to
-- dump it. I guess I want to see: the trailer untarped, the back gate locked,
-- the trailer connected to the truck, the trailer empty at the dump landfill,
-- the receipt after it's been paid. Make the list, make it logical. See if we
-- should add anything else."
--
-- Those five, in his order, are three moments and not one list: three of them
-- happen at the job site before the truck moves, one at the facility, one at the
-- scale house. So the plan is three ordered steps, each a screen flow, each
-- separately verified -- the same shape as Building Access (5 steps) and
-- Material Delivery (5), not the single-screen shape of the monthly vehicle
-- check, which is one person standing at one truck.
--
--   1. Loaded Trailer Ready to Leave the Site
--   2. Load Dumped at the Disposal Facility
--   3. Disposal Receipt and Cost
--
-- ADDED, each for a stated reason, none of them padding:
--   * Load Tarped for the Road -- his list photographs the load untarped and
--     the gate locked, and then the truck pulls onto a highway. An uncovered
--     load is a citation and the thing a complaint will be about.
--   * Landfill or Transfer Station -- which facility took it. Free TEXT and not
--     a picklist, deliberately: nobody has given LEAP the list of facilities,
--     and a dropdown that does not contain the place you are standing in blocks
--     the driver. It reads off the ticket in his hand.
--   * Net Weight Dumped and Amount Paid -- the receipt is a picture; these are
--     the two numbers on it that a report can add up. Disposal is a project
--     cost, and tons removed is a programme figure.
--   * Paid With -- so AP can reconcile the charge against a card statement.
--   * Dump Trailer -- a `vehicle` field, which stamps work_orders.vehicle_id,
--     so "every run VEH-000nn made" is a join and the trailer carries its own
--     history. It is the ONLY vehicle field on the plan: save_work_step_vehicle
--     stamps that one column unconditionally, so a second vehicle field would
--     silently overwrite the first. The trailer is the asset going to the
--     landfill; the truck towing it is shown in the hitch photo.
--
-- CONSIDERED AND LEFT OUT: a "gate closed for the return trip" photo at the
-- facility. It mirrors step 1, but an empty trailer's gate is not evidence
-- anybody will ever look at, and a prompt nobody reads erodes the ones they do.
-- Say the word and it is one row.
--
-- Net Weight is the one field that is NOT required: plenty of construction and
-- demolition facilities price by the cubic yard and never put a weight on the
-- ticket, and a required field that cannot be answered is a driver stuck in a
-- queue. Everything else on the run must exist every time.

-- 1. The work order record type.
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_by, picklist_description)
VALUES
  ('work_orders', 'record_type', 'DUMP-TRAILER-DISPOSAL-RUN', 'Dump Trailer Disposal Run',
   true, 667, 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'Work order documenting a loaded dump trailer taken to a landfill or transfer station, emptied, and paid for.');

-- 2. A trailer is a fleet asset, and the fleet has only ever had one record
--    type. Adding the type is what lets the dump trailers be entered in
--    LEAP Admin -> Fleet; no trailer records are invented here, because a
--    vehicle record with a made-up name and no plate is not data.
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_by, picklist_description)
VALUES
  ('vehicles', 'record_type', 'TRAILER', 'Trailer',
   true, 2, 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'A towed asset — dump trailer, equipment trailer — that carries its own maintenance and disposal history.');

-- 3. How the run was paid for. The server refuses anything outside this list,
--    so it is a dropdown with no free text.
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'work_step_fields', 'dtr_paid_with', v.val, v.val, true, v.ord,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (VALUES
  ('Company Credit Card', 10),
  ('Fuel Card', 20),
  ('Cash', 30),
  ('Billed to the Company Account', 40),
  ('Prepaid Account', 50)
) AS v(val, ord);

-- 4. The three steps, their fields, the plan, and the work type.
WITH step_defs AS (
  SELECT * FROM (VALUES
    (1, 'Loaded Trailer Ready to Leave the Site',
        'Before the truck moves: what is in the trailer, that the back gate is locked, that the trailer is properly hitched, and that the load is covered for the road.',
        20),
    (2, 'Load Dumped at the Disposal Facility',
        'At the landfill or transfer station: which facility took the load, and the trailer empty after dumping.',
        20),
    (3, 'Disposal Receipt and Cost',
        'At the scale house: the paid ticket, and the two numbers on it that a report can add up.',
        10)
  ) AS s(ord, name, descr, mins)
),
new_steps AS (
  INSERT INTO public.work_step_templates (
    wst_record_number, wst_name, wst_description,
    wst_owner, wst_created_by,
    wst_required_evidence_type_id, wst_photos_required_count, wst_is_screen_flow,
    wst_estimated_duration_minutes,
    wst_assigned_owner_role_id, wst_verifier_role_id, wst_is_active
  )
  SELECT '', s.name, s.descr,
         'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
         (SELECT id FROM public.picklist_values
           WHERE picklist_object='work_step_templates'
             AND picklist_field='wst_required_evidence_type_id'
             AND picklist_value='Photo' LIMIT 1),
         0, true, s.mins,
         (SELECT id FROM public.roles WHERE role_name='Lead Technician'),
         (SELECT id FROM public.roles WHERE role_name='Project Site Lead'),
         true
    FROM step_defs s
  RETURNING id, wst_name
),
step_fields AS (
  INSERT INTO public.work_step_template_fields (
    wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
    wstf_field_label, wstf_field_name, wstf_field_type,
    wstf_is_required, wstf_allow_not_present, wstf_sort_order, wstf_unit, wstf_help_text
  )
  SELECT '', 'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
         ns.id, f.label, f.name, f.ftype, f.req, false, f.ord, f.unit, f.help
    FROM (VALUES
      ('Loaded Trailer Ready to Leave the Site', 'Dump Trailer', 'dump_trailer', 'vehicle', false, 1, NULL::text,
       'Which trailer you are hauling. If it is not listed, it can be added in LEAP Admin under Fleet.'),
      ('Loaded Trailer Ready to Leave the Site', 'Load in the Trailer — Untarped', 'dtr_load_untarped', 'photo', true, 2, NULL,
       'Tarp off, photographed from the back or the side so the whole load is visible. This is the record of what was hauled.'),
      ('Loaded Trailer Ready to Leave the Site', 'Back Gate Locked', 'dtr_back_gate_locked', 'photo', true, 3, NULL,
       'Close up on the back gate closed, latched and pinned.'),
      ('Loaded Trailer Ready to Leave the Site', 'Trailer Connected to the Truck', 'dtr_trailer_connected', 'photo', true, 4, NULL,
       'The coupler down and latched, safety chains crossed, breakaway cable and light cord plugged in — all in one frame.'),
      ('Loaded Trailer Ready to Leave the Site', 'Load Tarped for the Road', 'dtr_load_tarped', 'photo', true, 5, NULL,
       'The tarp over the load and tied down, before you pull off the site.'),

      ('Load Dumped at the Disposal Facility', 'Landfill or Transfer Station', 'dtr_disposal_facility', 'text', true, 1, NULL,
       'The name of the facility, as it reads on the ticket.'),
      ('Load Dumped at the Disposal Facility', 'Trailer Empty at the Landfill', 'dtr_trailer_empty', 'photo', true, 2, NULL,
       'Inside the empty trailer, taken at the facility with the bed raised or the gate open.'),

      ('Disposal Receipt and Cost', 'Paid Receipt or Scale Ticket', 'dtr_paid_receipt', 'photo', true, 1, NULL,
       'The whole ticket after it is paid — facility, date, weight and amount all readable in one shot.'),
      ('Disposal Receipt and Cost', 'Net Weight Dumped', 'dtr_net_weight_tons', 'number', false, 2, 'tons',
       'The net weight from the scale ticket. Leave it blank if the facility charges by volume and never weighed you.'),
      ('Disposal Receipt and Cost', 'Amount Paid', 'dtr_disposal_cost', 'number', true, 3, 'USD',
       'The total charged on the ticket.'),
      ('Disposal Receipt and Cost', 'Paid With', 'dtr_paid_with', 'select', true, 4, NULL,
       'How the charge was settled, so it can be matched to the card statement.')
    ) AS f(step, label, name, ftype, req, ord, unit, help)
    JOIN new_steps ns ON ns.wst_name = f.step
  RETURNING 1
),
new_plan AS (
  INSERT INTO public.work_plan_templates (
    wpt_record_number, wpt_name, wpt_description,
    wpt_owner, wpt_created_by, wpt_is_active, wpt_allow_any_order
  ) VALUES (
    '', 'Dump Trailer Disposal Run - Standard',
    'Leaving the site with a secured, covered load; emptying it at a named facility; and the paid ticket with its weight and cost. Ordered, because the three steps are three places.',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    true, false
  ) RETURNING id
),
new_entries AS (
  INSERT INTO public.work_plan_template_entries (
    wpte_record_number, wpte_name, wpte_created_by,
    work_plan_template_id, work_step_template_id, wpte_execution_order
  )
  SELECT '', ns.wst_name, 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
         np.id, ns.id, s.ord
    FROM new_plan np, new_steps ns
    JOIN step_defs s ON s.name = ns.wst_name
  RETURNING 1
)
INSERT INTO public.work_types (
  work_type_record_number, work_type_name, work_type_description,
  work_type_owner, work_type_created_by, work_type_is_active,
  work_type_duration_minutes, work_type_post_buffer_minutes,
  work_type_is_technician_creatable,
  work_type_default_work_plan_template_id,
  work_type_default_work_order_record_type
)
SELECT
  '', 'Dump Trailer Disposal Run',
  'A loaded dump trailer taken from a job site to a landfill or transfer station, emptied, and paid for. Records the load before it leaves, the trailer empty at the facility, and the paid ticket with its weight and cost. Created by technicians in the field.',
  'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af', true,
  90, 5, true,
  new_plan.id,
  (SELECT id FROM public.picklist_values
    WHERE picklist_object='work_orders' AND picklist_field='record_type'
      AND picklist_value='DUMP-TRAILER-DISPOSAL-RUN')
FROM new_plan;

-- 5. Assert what was built, rather than assume it.
DO $$
DECLARE
  v_wt public.work_types;
  v_n  integer;
BEGIN
  SELECT * INTO v_wt FROM public.work_types
   WHERE work_type_name = 'Dump Trailer Disposal Run' AND work_type_is_deleted IS NOT TRUE;
  IF v_wt.id IS NULL THEN
    RAISE EXCEPTION 'The Dump Trailer Disposal Run work type was not created.';
  END IF;
  IF v_wt.work_type_is_technician_creatable IS NOT TRUE THEN
    RAISE EXCEPTION 'It is not technician-creatable — it would never appear in the LEAP Pad Create Work Order menu.';
  END IF;
  IF v_wt.work_type_default_work_plan_template_id IS NULL
     OR v_wt.work_type_default_work_order_record_type IS NULL THEN
    RAISE EXCEPTION 'It has no default work plan template or record type — create_technician_work_order refuses such a work type.';
  END IF;

  SELECT count(*) INTO v_n FROM public.work_plan_template_entries e
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND e.wpte_is_deleted IS NOT TRUE;
  IF v_n <> 3 THEN RAISE EXCEPTION 'Expected 3 steps in the plan, found %.', v_n; END IF;

  -- The order is the trip: leave the site, dump, pay.
  IF NOT EXISTS (
    SELECT 1 FROM public.work_plan_template_entries e
      JOIN public.work_step_templates s ON s.id = e.work_step_template_id
     WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
       AND e.wpte_execution_order = 1 AND s.wst_name = 'Loaded Trailer Ready to Leave the Site'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.work_plan_template_entries e
      JOIN public.work_step_templates s ON s.id = e.work_step_template_id
     WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
       AND e.wpte_execution_order = 3 AND s.wst_name = 'Disposal Receipt and Cost'
  ) THEN
    RAISE EXCEPTION 'The three steps are not in trip order — the run reads as leave the site, dump, pay.';
  END IF;

  -- Every step must be a screen flow: outside one, a `photo` field falls
  -- through to the plain field input and renders as a TEXT BOX.
  SELECT count(*) INTO v_n FROM public.work_plan_template_entries e
    JOIN public.work_step_templates s ON s.id = e.work_step_template_id
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND e.wpte_is_deleted IS NOT TRUE AND s.wst_is_screen_flow IS TRUE;
  IF v_n <> 3 THEN RAISE EXCEPTION 'Only % of 3 steps is a screen flow.', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.work_plan_template_entries e
    JOIN public.work_step_template_fields f ON f.work_step_template_id = e.work_step_template_id
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND e.wpte_is_deleted IS NOT TRUE AND f.wstf_is_deleted IS NOT TRUE;
  IF v_n <> 11 THEN RAISE EXCEPTION 'Expected 11 fields across the three steps, found %.', v_n; END IF;

  -- His five, by name, so a later edit cannot quietly drop one.
  SELECT count(*) INTO v_n FROM public.work_plan_template_entries e
    JOIN public.work_step_template_fields f ON f.work_step_template_id = e.work_step_template_id
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND f.wstf_field_name IN ('dtr_load_untarped','dtr_back_gate_locked','dtr_trailer_connected',
                               'dtr_trailer_empty','dtr_paid_receipt')
     AND f.wstf_field_type = 'photo' AND f.wstf_is_required IS TRUE;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'The five photographs that were asked for are not all present and required — found %.', v_n;
  END IF;

  -- Exactly one vehicle field: save_work_step_vehicle stamps
  -- work_orders.vehicle_id unconditionally, so a second one overwrites it.
  SELECT count(*) INTO v_n FROM public.work_plan_template_entries e
    JOIN public.work_step_template_fields f ON f.work_step_template_id = e.work_step_template_id
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND f.wstf_field_type = 'vehicle' AND f.wstf_is_deleted IS NOT TRUE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 vehicle field, found % — two would fight over work_orders.vehicle_id.', v_n;
  END IF;

  -- The one field a driver is allowed to leave blank, and only that one.
  SELECT count(*) INTO v_n FROM public.work_plan_template_entries e
    JOIN public.work_step_template_fields f ON f.work_step_template_id = e.work_step_template_id
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND f.wstf_is_required IS NOT TRUE AND f.wstf_is_deleted IS NOT TRUE
     AND f.wstf_field_name NOT IN ('dtr_net_weight_tons','dump_trailer');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% field(s) beyond the weight and the trailer are optional — everything else on a run happens every time.', v_n;
  END IF;

  -- A 'select' field with no options is a dropdown that cannot be answered.
  SELECT count(*) INTO v_n FROM public.picklist_values
   WHERE picklist_object='work_step_fields' AND picklist_field='dtr_paid_with'
     AND picklist_is_active IS TRUE;
  IF v_n <> 5 THEN RAISE EXCEPTION 'Paid With has % options, expected 5.', v_n; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.picklist_values
                  WHERE picklist_object='vehicles' AND picklist_field='record_type'
                    AND picklist_value='TRAILER' AND picklist_is_active IS TRUE) THEN
    RAISE EXCEPTION 'The Trailer fleet record type is missing — there would be nothing for the Dump Trailer field to point at.';
  END IF;
END $$;
