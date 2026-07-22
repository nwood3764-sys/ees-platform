-- =============================================================================
-- Exhaust Fan Replacement — In-Unit work plan (multi-family energy savings
-- retrofit). Built to the exhaust-fan installation procedure + field checklist
-- + photo procedure. Pure config on the existing data-driven work-plan engine
-- (work_types → work_plan_templates → work_plan_template_entries →
-- work_step_templates → work_step_template_fields); no schema change and no
-- frontend change — LEAP Pad already renders Photo / Measurement / number /
-- select fields generically and hard-gates step completion through
-- _work_step_evidence_gap.
--
-- Home work type: the existing WT-00024 "Exhaust Fan Replacement" (record type
-- Install) — it had no work plan wired. We attach this new purpose-built plan
-- as its default template and give it a per-unit duration, exactly the way the
-- Insulation Removal plan (WPT-00004) was wired onto the pre-existing WT-00041.
-- A duplicate work type is deliberately NOT created.
--
-- One work order per unit (work orders never span units). The step list is the
-- required photo "sandwich" — building number and unit number bracket the job
-- on entry and exit — plus the evidence-bearing installation steps and the
-- gated capture fields (fan location, configured airflow CFM, power-off
-- acknowledgement, functional-test result). Pure "technician confirmation"
-- micro-actions from the written procedure (drop cloth, test-fit, breaker off,
-- etc.) are folded into the description of the artifact-bearing step they
-- support, so every step here produces a real evidence artifact — the same
-- discipline used by WPT-00004 and the Material Delivery plan.
--
-- New WPT-00014 (auto-numbered) + 17 purpose-built step templates (never
-- shared with another plan). Every step owned by Lead Technician, verified by
-- Project Site Lead. Help article HA-00132.
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
  ('work_step_fields', 'power_confirmed_off',     'Yes',      'Yes — power confirmed off at the breaker', 10),
  ('work_step_fields', 'power_confirmed_off',     'No',       'No — power is still on',                   20),
  ('work_step_fields', 'fan_operating_correctly', 'Yes',      'Yes — fan runs and exhausts correctly',    10),
  ('work_step_fields', 'fan_operating_correctly', 'No',       'No — fan does not operate correctly',       20)
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
  s01 uuid; s02 uuid; s03 uuid; s04 uuid; s05 uuid; s06 uuid; s07 uuid; s08 uuid; s09 uuid;
  s10 uuid; s11 uuid; s12 uuid; s13 uuid; s14 uuid; s15 uuid; s16 uuid; s17 uuid;
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
    'In-unit exhaust fan replacement (one work order per unit). Photo chain of custody bracketed by building-number and unit-number photos on entry and exit, with evidence-bearing steps through dust containment, existing-fan removal, wiring, junction box, ductwork, fan install and functional test, beauty cover, and cleanup. Capture fields record the fan location (Bathroom = 80 CFM target, Kitchen = 100 CFM target), the configured airflow, the breaker power-off acknowledgement, and the functional-test result. Every step is owned by the Lead Technician and verified by the Project Site Lead.',
    true, v_nick, v_nick)
  RETURNING id INTO v_wpt;

  -- Step templates (purpose-built, never shared) -------------------------------
  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Building Number Photo - Arrival',
     'Photograph the building number on arrival, before entering the unit. First photo in the chain of custody.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s01;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Unit Number Photo - Arrival',
     'Photograph the unit number or door on arrival, identifying the exact unit this work order covers. One work order per unit.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s02;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Work Area Photo - Before Setup',
     'Photograph the bathroom or kitchen work area and the existing fan location before any setup begins.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s03;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Dust Containment Installed Photo',
     'Lay drop cloths, tape off the area, and install dust containment to protect the unit. Photograph the completed containment.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s04;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Existing Exhaust Fan Photo - Power Confirmed Off',
     'Confirm power is off at the breaker, then photograph the existing exhaust fan in place. Record the power-off acknowledgement before proceeding.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s05;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Existing Fan Removed Photo - Opening Exposed',
     'Remove the existing fan and, if needed, modify the opening to fit the new housing. Photograph the exposed opening.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s06;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Wiring Connections Completed Photo',
     'Connect the junction box to the existing conduit, test-fit the fan housing, and complete all wiring connections. Photograph the completed wiring.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s07;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Junction Box Mounted Photo',
     'Mount the junction box securely. Photograph it mounted in place.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s08;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Ductwork Connected Photo',
     'Connect the ductwork to the fan so it exhausts to the exterior. Photograph the duct connection.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s09;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Fan Housing Labeled Photo - Building and Unit Number',
     'Write the building number and unit number on the fan housing. Photograph the label.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s10;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Airflow Configuration and Fan Location',
     'Select whether the fan serves a bathroom (target 80 CFM) or a kitchen (target 100 CFM) and record the configured airflow in CFM.',
     true, v_lead, v_psl, NULL, 0, v_nick, v_nick)
  RETURNING id INTO s11;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Fan Functional Test Photo - Fan Running',
     'Install the fan motor, run the functional test, and photograph the fan operating. Record whether the fan runs and exhausts correctly.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s12;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Installed Exhaust Fan Photo',
     'Photograph the fully installed exhaust fan before the beauty cover goes on.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s13;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Beauty Cover Installed Photo',
     'Install the beauty cover / grille. Photograph it installed.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s14;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Containment Removed and Work Area Cleaned Photo',
     'Remove all dust containment and clean the work area. Photograph the cleaned area.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s15;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Unit Number Photo - Exit',
     'Photograph the unit number or door on exit, closing the chain of custody for the unit.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s16;

  INSERT INTO public.work_step_templates
    (wst_record_number, wst_name, wst_description, wst_is_active,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_owner, wst_created_by)
  VALUES
    ('', 'Building Number Photo - Exit',
     'Photograph the building number on exit, closing the chain of custody.',
     true, v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO s17;

  -- Plan entries (execution order) ---------------------------------------------
  INSERT INTO public.work_plan_template_entries
    (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
  VALUES
    ('', 'Building Number Photo - Arrival',                       v_nick, v_wpt, s01, 1),
    ('', 'Unit Number Photo - Arrival',                          v_nick, v_wpt, s02, 2),
    ('', 'Work Area Photo - Before Setup',                       v_nick, v_wpt, s03, 3),
    ('', 'Dust Containment Installed Photo',                     v_nick, v_wpt, s04, 4),
    ('', 'Existing Exhaust Fan Photo - Power Confirmed Off',     v_nick, v_wpt, s05, 5),
    ('', 'Existing Fan Removed Photo - Opening Exposed',         v_nick, v_wpt, s06, 6),
    ('', 'Wiring Connections Completed Photo',                   v_nick, v_wpt, s07, 7),
    ('', 'Junction Box Mounted Photo',                           v_nick, v_wpt, s08, 8),
    ('', 'Ductwork Connected Photo',                             v_nick, v_wpt, s09, 9),
    ('', 'Fan Housing Labeled Photo - Building and Unit Number', v_nick, v_wpt, s10, 10),
    ('', 'Airflow Configuration and Fan Location',               v_nick, v_wpt, s11, 11),
    ('', 'Fan Functional Test Photo - Fan Running',              v_nick, v_wpt, s12, 12),
    ('', 'Installed Exhaust Fan Photo',                          v_nick, v_wpt, s13, 13),
    ('', 'Beauty Cover Installed Photo',                         v_nick, v_wpt, s14, 14),
    ('', 'Containment Removed and Work Area Cleaned Photo',      v_nick, v_wpt, s15, 15),
    ('', 'Unit Number Photo - Exit',                            v_nick, v_wpt, s16, 16),
    ('', 'Building Number Photo - Exit',                        v_nick, v_wpt, s17, 17);

  -- Capture fields (hard-gated: required fields must have a value to complete) --
  INSERT INTO public.work_step_template_fields
    (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name,
     wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
  VALUES
    -- Existing Exhaust Fan Photo - Power Confirmed Off
    ('', s05, 'Power Confirmed Off at Breaker', 'power_confirmed_off',     'select', true, NULL,  1, v_nick, v_nick),
    -- Airflow Configuration and Fan Location
    ('', s11, 'Fan Location Type',              'fan_location_type',       'select', true, NULL,  1, v_nick, v_nick),
    ('', s11, 'Configured Airflow',             'configured_airflow_cfm',  'number', true, 'CFM', 2, v_nick, v_nick),
    -- Fan Functional Test Photo - Fan Running
    ('', s12, 'Fan Operating Correctly',        'fan_operating_correctly', 'select', true, NULL,  1, v_nick, v_nick);

  -- Wire the plan onto the existing work type ----------------------------------
  UPDATE public.work_types
     SET work_type_default_work_plan_template_id = v_wpt,
         work_type_duration_minutes = 90,
         work_type_estimated_duration = 1.5,
         work_type_description = 'In-unit exhaust fan replacement — remove the existing fan and install a new one with a full photo chain of custody, airflow configuration (Bathroom 80 CFM / Kitchen 100 CFM), functional test, and cleanup. One work order per unit.',
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
  'The in-unit Exhaust Fan Replacement work plan: 17 evidence-bearing steps, the photo chain of custody, and the required capture fields (fan location, configured CFM, functional test).',
$md$# Exhaust Fan Replacement Work Plan

The **Exhaust Fan Replacement** work type (WT-00024) now carries a standard work plan, **Exhaust Fan Replacement - In-Unit - Standard**. Every exhaust fan replacement work order created from this work type instantiates the same 17 steps in order.

**One work order per unit.** Exhaust fan work orders never span units — each unit gets its own work order, bracketed by unit-number photos on entry and exit.

## Roles

- **Owner of every step:** Lead Technician.
- **Verifier of every step:** Project Site Lead.

## The steps, in order

| # | Step | Evidence |
|---|------|----------|
| 1 | Building Number Photo - Arrival | 1 photo |
| 2 | Unit Number Photo - Arrival | 1 photo |
| 3 | Work Area Photo - Before Setup | 1 photo |
| 4 | Dust Containment Installed Photo | 1 photo |
| 5 | Existing Exhaust Fan Photo - Power Confirmed Off | 1 photo + power-off acknowledgement |
| 6 | Existing Fan Removed Photo - Opening Exposed | 1 photo |
| 7 | Wiring Connections Completed Photo | 1 photo |
| 8 | Junction Box Mounted Photo | 1 photo |
| 9 | Ductwork Connected Photo | 1 photo |
| 10 | Fan Housing Labeled Photo - Building and Unit Number | 1 photo |
| 11 | Airflow Configuration and Fan Location | Fan Location Type + Configured Airflow (CFM) |
| 12 | Fan Functional Test Photo - Fan Running | 1 photo + functional-test result |
| 13 | Installed Exhaust Fan Photo | 1 photo |
| 14 | Beauty Cover Installed Photo | 1 photo |
| 15 | Containment Removed and Work Area Cleaned Photo | 1 photo |
| 16 | Unit Number Photo - Exit | 1 photo |
| 17 | Building Number Photo - Exit | 1 photo |

## The photo chain of custody

The building-number and unit-number photos bracket the job — captured on arrival (steps 1–2) and again on exit (steps 16–17) — so every work order proves which building and unit the crew was in, start to finish. In between, each installation stage records its own before/after evidence: existing fan, exposed opening, wiring, junction box, ductwork, installed fan, beauty cover, and the cleaned work area.

## Capture fields (hard-gated)

Three steps require data entry before they can be completed:

- **Step 5 — Power Confirmed Off at Breaker** (Yes / No): the technician acknowledges the breaker state before touching the existing fan.
- **Step 11 — Fan Location Type** (Bathroom / Kitchen) and **Configured Airflow (CFM)**: bathrooms target **80 CFM**, kitchens target **100 CFM**. Record the airflow the fan was configured to.
- **Step 12 — Fan Operating Correctly** (Yes / No): the functional-test result.

A step that requires a photo or a field value cannot be marked **Completed** until that evidence is present — LEAP Pad blocks it and tells the technician exactly what is missing. If a step genuinely does not apply, mark it **Not Applicable** with a reason rather than leaving it open.

## Configuration

Everything above is data-driven and editable in LEAP Admin — steps, order, photo counts, capture fields, and the Bathroom/Kitchen and Yes/No option lists are all records, nothing is hardcoded.
$md$,
  'Field Service', 'internal', true,
  'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
);

NOTIFY pgrst, 'reload schema';
