-- =============================================================================
-- Exhaust Fan Replacement — In-Unit work plan (multi-family energy savings
-- retrofit). Built to the exhaust-fan installation procedure + field checklist
-- + photo procedure, to the reviewed 28-step field list. Pure config on the
-- existing data-driven work-plan engine (work_types → work_plan_templates →
-- work_plan_template_entries → work_step_templates → work_step_template_fields);
-- no schema change and no frontend change — LEAP Pad already renders Photo /
-- number / select fields generically and hard-gates step completion through
-- _work_step_evidence_gap.
--
-- Home work type: the existing WT-00024 "Exhaust Fan Replacement" (record type
-- Install) — it had no work plan wired. We attach this new purpose-built plan
-- as its default template and give it a per-unit duration, exactly the way the
-- Insulation Removal plan (WPT-00004) was wired onto the pre-existing WT-00041.
-- A duplicate work type is deliberately NOT created.
--
-- One work order per unit (work orders never span units). 28 steps across 8
-- phases: Documentation, Dust Containment, Electrical Safety, Removal,
-- Electrical Installation, Ventilation, Fan Installation, Finish Work. Photo
-- steps carry a hard photo gate. "Validation" steps (drop cloth, verify power
-- off, test fit, wiring, etc.) are completable checkpoints — the Lead
-- Technician marks them done and the Project Site Lead verifies, no photo
-- required. Two steps capture hard-gated data fields: Configure Airflow (Fan
-- Location Type + Configured Airflow CFM) and Functional Test (Fan Operating).
--
-- New work plan template (auto-numbered) + 28 purpose-built step templates
-- (never shared with another plan). Every step owned by Lead Technician,
-- verified by Project Site Lead, plus a help article. All record numbers are
-- assigned by their auto-number triggers at apply time.
-- =============================================================================

-- ── 'select' field option lists (admin-manageable picklists) ─────────────────
-- Options live under picklist_object='work_step_fields', picklist_field=<the
-- field's wstf_field_name>, matching save_work_step_field_value's validation.
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT v.picklist_object, v.picklist_field, v.picklist_value, v.picklist_label, true, v.so, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (VALUES
  ('work_step_fields', 'fan_location_type',       'Bathroom', 'Bathroom', 10),
  ('work_step_fields', 'fan_location_type',       'Kitchen',  'Kitchen',  20),
  ('work_step_fields', 'fan_operating_correctly', 'Yes',      'Yes — fan runs and exhausts correctly', 10),
  ('work_step_fields', 'fan_operating_correctly', 'No',       'No — fan does not operate correctly',    20)
) AS v(picklist_object, picklist_field, picklist_value, picklist_label, so)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values pv
  WHERE pv.picklist_object = v.picklist_object
    AND pv.picklist_field  = v.picklist_field
    AND pv.picklist_value  = v.picklist_value
);

-- ── Work plan template + step templates + entries + fields + work-type wiring ─
DO $$
DECLARE
  v_nick  uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_lead  uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262'; -- Lead Technician
  v_psl   uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487'; -- Project Site Lead
  v_photo uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1'; -- Photo evidence type
  v_wpt   uuid;
  v_wt    uuid;
  s uuid[] := array_fill(NULL::uuid, ARRAY[28]);
  v_id uuid;

  -- (name, description, photos_required, is_photo_step)
  rec record;
BEGIN
  SELECT id INTO v_wt FROM public.work_types
   WHERE work_type_record_number = 'WT-00024' AND work_type_is_deleted IS NOT TRUE;
  IF v_wt IS NULL THEN
    RAISE EXCEPTION 'Work type WT-00024 (Exhaust Fan Replacement) not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.work_plan_templates
             WHERE wpt_name = 'Exhaust Fan Replacement - In-Unit - Standard'
               AND wpt_is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'Exhaust Fan Replacement work plan already exists';
  END IF;

  -- Work plan template ---------------------------------------------------------
  INSERT INTO public.work_plan_templates
    (wpt_record_number, wpt_name, wpt_description, wpt_is_active, wpt_owner, wpt_created_by)
  VALUES ('', 'Exhaust Fan Replacement - In-Unit - Standard',
    'In-unit exhaust fan replacement (one work order per unit), 28 steps across 8 phases: Documentation, Dust Containment, Electrical Safety, Removal, Electrical Installation, Ventilation, Fan Installation, and Finish Work. Photo steps are hard-gated on a photo; "Validation" steps are completable checkpoints the Lead Technician marks done and the Project Site Lead verifies. Configure Airflow captures the fan location (Bathroom = 80 CFM target, Kitchen = 100 CFM target) and configured airflow; Functional Test captures whether the fan operates. Every step is owned by the Lead Technician and verified by the Project Site Lead.',
    true, v_nick, v_nick)
  RETURNING id INTO v_wpt;

  -- Step templates (purpose-built, never shared) -------------------------------
  -- Photo step => Photo evidence + 1 required photo. Checkpoint => no evidence
  -- type, 0 photos (the technician completes it as the confirmation).
  FOR rec IN
    SELECT * FROM (VALUES
      ( 1, 'Photo Building Number',                       'Photograph the building number on arrival. First photo in the chain of custody.',                                          1, true ),
      ( 2, 'Photo Unit Number',                           'Photograph the unit number or door on arrival, identifying the exact unit this work order covers. One work order per unit.', 1, true ),
      ( 3, 'Photo Work Area Before Setup',                'Photograph the bathroom or kitchen work area and the existing fan location before any setup or containment goes in.',        1, true ),
      ( 4, 'Install Drop Cloth and Taping',               'Lay drop cloths and tape off the work area to protect the unit. Mark complete when done.',                                    0, false ),
      ( 5, 'Install Dust Containment',                    'Install dust containment around the work area. Photograph the completed containment.',                                        1, true ),
      ( 6, 'Verify Power Off',                            'Confirm power to the existing fan is off at the breaker before touching any wiring. Mark complete to confirm.',              0, false ),
      ( 7, 'Photo Existing Fan',                          'Photograph the existing exhaust fan in place before removal.',                                                               1, true ),
      ( 8, 'Remove Existing Fan',                         'Remove the existing fan. Photograph the opening with the fan removed.',                                                       1, true ),
      ( 9, 'Modify Opening if Needed',                    'Modify the opening if needed to fit the new housing, and photograph it. If no modification was required, mark this step Not Applicable with a reason.', 1, true ),
      (10, 'Connect Junction Box to Existing Conduit',    'Connect the junction box to the existing conduit. Mark complete when done.',                                                  0, false ),
      (11, 'Test Fit Fan Housing',                        'Test-fit the new fan housing in the opening. Mark complete when it fits.',                                                    0, false ),
      (12, 'Complete Wiring Connections',                 'Make all wiring connections to the fan. Mark complete when done.',                                                            0, false ),
      (13, 'Photo Completed Wiring',                      'Photograph the completed wiring connections.',                                                                               1, true ),
      (14, 'Mount Junction Box',                          'Mount and secure the junction box. Mark complete when done.',                                                                0, false ),
      (15, 'Photo Mounted Junction Box',                  'Photograph the mounted junction box.',                                                                                       1, true ),
      (16, 'Connect Ductwork',                            'Connect the ductwork so the fan exhausts to the exterior. Mark complete when done.',                                          0, false ),
      (17, 'Photo Duct Connection',                       'Photograph the duct connection.',                                                                                            1, true ),
      (18, 'Label Fan Housing',                           'Write the building number and unit number on the fan housing. A photo of the label is optional.',                            0, false ),
      (19, 'Configure Airflow',                           'Select whether the fan serves a bathroom (target 80 CFM) or a kitchen (target 100 CFM) and record the configured airflow in CFM.', 0, false ),
      (20, 'Install Fan Motor',                           'Install the fan motor into the housing. Mark complete when done.',                                                            0, false ),
      (21, 'Functional Test',                             'Run the fan and confirm it operates and exhausts correctly. Record the result.',                                             0, false ),
      (22, 'Photo Installed Fan',                         'Photograph the fully installed exhaust fan.',                                                                                1, true ),
      (23, 'Install Beauty Cover',                        'Install the beauty cover / grille. Mark complete when done.',                                                                 0, false ),
      (24, 'Photo Beauty Cover',                          'Photograph the installed beauty cover.',                                                                                     1, true ),
      (25, 'Remove Containment',                          'Remove all dust containment from the work area. Mark complete when done.',                                                    0, false ),
      (26, 'Clean Work Area',                             'Clean the work area. Photograph the cleaned area.',                                                                          1, true ),
      (27, 'Photo Entry/Exit Area',                       'Photograph the entry/exit area on the way out to document the unit was left clean.',                                          1, true ),
      (28, 'Photo Unit Number On Exit',                   'Photograph the unit number on exit, closing the chain of custody. Final photo of the work order.',                           1, true )
    ) AS t(pos, nm, descr, photos, is_photo)
    ORDER BY 1
  LOOP
    INSERT INTO public.work_step_templates
      (wst_record_number, wst_name, wst_description, wst_is_active,
       wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
       wst_photos_required_count, wst_owner, wst_created_by)
    VALUES ('', rec.nm, rec.descr, true, v_lead, v_psl,
            CASE WHEN rec.is_photo THEN v_photo ELSE NULL END,
            rec.photos, v_nick, v_nick)
    RETURNING id INTO v_id;
    s[rec.pos] := v_id;

    INSERT INTO public.work_plan_template_entries
      (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', rec.nm, v_nick, v_wpt, v_id, rec.pos);
  END LOOP;

  -- Capture fields (hard-gated: required fields must have a value to complete) --
  INSERT INTO public.work_step_template_fields
    (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name,
     wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
  VALUES
    -- Step 19 Configure Airflow
    ('', s[19], 'Fan Location Type',       'fan_location_type',       'select', true, NULL,  1, v_nick, v_nick),
    ('', s[19], 'Configured Airflow',      'configured_airflow_cfm',  'number', true, 'CFM', 2, v_nick, v_nick),
    -- Step 21 Functional Test
    ('', s[21], 'Fan Operating Correctly', 'fan_operating_correctly', 'select', true, NULL,  1, v_nick, v_nick);

  -- Wire the plan onto the existing work type ----------------------------------
  UPDATE public.work_types
     SET work_type_default_work_plan_template_id = v_wpt,
         work_type_duration_minutes = 90,
         work_type_estimated_duration = 1.5,
         work_type_description = 'In-unit exhaust fan replacement — remove the existing fan and install a new one following the 28-step field procedure (documentation, dust containment, electrical safety, removal, electrical install, ventilation, fan install with airflow configuration and functional test, and finish work). One work order per unit.',
         work_type_updated_by = v_nick,
         work_type_updated_at = now()
   WHERE id = v_wt;
END $$;

-- ── Help article ─────────────────────────────────────────────────────────────
INSERT INTO public.help_articles
  (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
   ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by)
VALUES (
  '', 'exhaust-fan-replacement-work-plan', 'Exhaust Fan Replacement Work Plan',
  'The in-unit Exhaust Fan Replacement work plan: 28 steps across 8 phases, hard-gated photos, completable checkpoints, and the Configure Airflow / Functional Test capture fields.',
$md$# Exhaust Fan Replacement Work Plan

The **Exhaust Fan Replacement** work type (WT-00024) now carries a standard work plan, **Exhaust Fan Replacement - In-Unit - Standard**. Every exhaust fan replacement work order created from this work type instantiates the same 28 steps in order.

**One work order per unit.** Exhaust fan work orders never span units — each unit gets its own work order.

## Roles

- **Owner of every step:** Lead Technician.
- **Verifier of every step:** Project Site Lead.

## How the steps work

- **Photo steps** are hard-gated: the step cannot be marked **Completed** until the required photo is captured. LEAP Pad blocks it and says what is missing.
- **Checkpoint steps** (the "Validation" items — drop cloth, verify power off, test fit, wiring, mount, etc.) have no photo. The technician marks them complete as the confirmation, and the Project Site Lead verifies.
- **Capture-field steps** require data entry before they can complete.
- Any step that genuinely does not apply can be marked **Not Applicable** with a reason (e.g. step 9 when no opening modification was needed).

## The 28 steps

**Phase 1 — Documentation**
1. Photo Building Number — *photo*
2. Photo Unit Number — *photo*

**Phase 2 — Dust Containment**
3. Photo Work Area Before Setup — *photo*
4. Install Drop Cloth and Taping — *checkpoint*
5. Install Dust Containment — *photo*

**Phase 3 — Electrical Safety**
6. Verify Power Off — *checkpoint*
7. Photo Existing Fan — *photo*

**Phase 4 — Removal**
8. Remove Existing Fan — *photo*
9. Modify Opening if Needed — *photo (N/A if none)*

**Phase 5 — Electrical Installation**
10. Connect Junction Box to Existing Conduit — *checkpoint*
11. Test Fit Fan Housing — *checkpoint*
12. Complete Wiring Connections — *checkpoint*
13. Photo Completed Wiring — *photo*
14. Mount Junction Box — *checkpoint*
15. Photo Mounted Junction Box — *photo*

**Phase 6 — Ventilation**
16. Connect Ductwork — *checkpoint*
17. Photo Duct Connection — *photo*

**Phase 7 — Fan Installation**
18. Label Fan Housing (write building + unit number) — *checkpoint, photo optional*
19. Configure Airflow — *fields: Fan Location Type + Configured Airflow (CFM)*
20. Install Fan Motor — *checkpoint*
21. Functional Test — *field: Fan Operating Correctly*
22. Photo Installed Fan — *photo*

**Phase 8 — Finish Work**
23. Install Beauty Cover — *checkpoint*
24. Photo Beauty Cover — *photo*
25. Remove Containment — *checkpoint*
26. Clean Work Area — *photo*
27. Photo Entry/Exit Area — *photo*
28. Photo Unit Number On Exit — *photo*

## Capture fields

- **Step 19 — Fan Location Type** (Bathroom / Kitchen) and **Configured Airflow (CFM)**: bathrooms target **80 CFM**, kitchens target **100 CFM**.
- **Step 21 — Fan Operating Correctly** (Yes / No): the functional-test result.

## Configuration

Everything above is data-driven and editable in LEAP Admin — steps, order, photo counts, capture fields, and the Bathroom/Kitchen and Yes/No option lists are all records, nothing is hardcoded.
$md$,
  'Field Service', 'internal', true,
  'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
);

NOTIFY pgrst, 'reload schema';
