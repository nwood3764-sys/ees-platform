-- =====================================================================
-- Single-Family Energy Assessment — Cooling System + Water Heating
-- System sections, and a BTU capture on all three mechanical sections
-- (Nicholas, 2026-07-22).
--
-- Cooling System and Water Heating System mirror Heating System exactly:
-- a photo-first screen flow with System Type / Fuel Type / Condition
-- selects, a Model Number text field, and now a BTUs number field. Each
-- system keeps its OWN admin-managed option lists (scoped by field name
-- under picklist_object='work_step_fields') — the type options differ per
-- system, Fuel (Gas/Electric) and Condition (Good/Fair/Poor) mirror
-- Heating. Everything reuses the existing screen-flow engine
-- (wst_is_screen_flow), field-save RPC, and evidence gate — the number
-- field type already renders in the flow, so no app change is required.
--
-- Idempotent: guards on the step name / field name / picklist value, and
-- the plan + heating step are resolved by lookup (works on prod, which
-- has WPT-00018 / WST-00189, and on a fresh replay).
-- =====================================================================

DO $$
DECLARE
  v_nick  uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_lead  uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262'; -- Lead Technician
  v_psl   uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487'; -- Project Site Lead
  v_photo uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1'; -- Photo evidence type
  v_plan  uuid;
  v_heat  uuid;
  v_cool  uuid;
  v_water uuid;
BEGIN
  SELECT id INTO v_plan FROM public.work_plan_templates
   WHERE wpt_name='Single-Family Energy Assessment - Standard' AND wpt_is_deleted IS NOT TRUE
   ORDER BY wpt_created_at LIMIT 1;
  SELECT id INTO v_heat FROM public.work_step_templates
   WHERE wst_name='Heating System' AND wst_is_deleted IS NOT TRUE
   ORDER BY wst_created_at LIMIT 1;

  -- ── 1. BTUs on the Heating System section ──────────────────────────────────
  IF v_heat IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.work_step_template_fields
     WHERE work_step_template_id=v_heat AND wstf_field_name='heating_system_btu' AND wstf_is_deleted IS NOT TRUE
  ) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
    VALUES ('', v_heat, 'BTUs', 'heating_system_btu', 'number', true, 'BTU', 5, v_nick, v_nick);
  END IF;

  -- ── 2. Cooling System section ──────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.work_step_templates WHERE wst_name='Cooling System' AND wst_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_templates (wst_record_number, wst_name, wst_description, wst_is_active,
      wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id, wst_photos_required_count,
      wst_is_screen_flow, wst_owner, wst_created_by)
    VALUES ('', 'Cooling System',
      'Photograph the cooling system, then record its type, fuel, condition, model number, and BTUs. The step completes once every prompt is answered.',
      true, v_lead, v_psl, v_photo, 1, true, v_nick, v_nick)
    RETURNING id INTO v_cool;

    INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
    VALUES
      ('', v_cool, 'Cooling System Type', 'cooling_system_type',         'select', true, NULL,  1, v_nick, v_nick),
      ('', v_cool, 'Fuel Type',           'cooling_system_fuel_type',    'select', true, NULL,  2, v_nick, v_nick),
      ('', v_cool, 'Condition',           'cooling_system_condition',    'select', true, NULL,  3, v_nick, v_nick),
      ('', v_cool, 'Model Number',        'cooling_system_model_number', 'text',   true, NULL,  4, v_nick, v_nick),
      ('', v_cool, 'BTUs',                'cooling_system_btu',          'number', true, 'BTU', 5, v_nick, v_nick);

    INSERT INTO public.work_plan_template_entries (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Cooling System', v_nick, v_plan, v_cool, 2);
  END IF;

  -- ── 3. Water Heating System section ────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.work_step_templates WHERE wst_name='Water Heating System' AND wst_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_templates (wst_record_number, wst_name, wst_description, wst_is_active,
      wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id, wst_photos_required_count,
      wst_is_screen_flow, wst_owner, wst_created_by)
    VALUES ('', 'Water Heating System',
      'Photograph the water heating system, then record its type, fuel, condition, model number, and BTUs. The step completes once every prompt is answered.',
      true, v_lead, v_psl, v_photo, 1, true, v_nick, v_nick)
    RETURNING id INTO v_water;

    INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
    VALUES
      ('', v_water, 'Water Heating System Type', 'water_heating_system_type',         'select', true, NULL,  1, v_nick, v_nick),
      ('', v_water, 'Fuel Type',                 'water_heating_system_fuel_type',    'select', true, NULL,  2, v_nick, v_nick),
      ('', v_water, 'Condition',                 'water_heating_system_condition',    'select', true, NULL,  3, v_nick, v_nick),
      ('', v_water, 'Model Number',              'water_heating_system_model_number', 'text',   true, NULL,  4, v_nick, v_nick),
      ('', v_water, 'BTUs',                      'water_heating_system_btu',          'number', true, 'BTU', 5, v_nick, v_nick);

    INSERT INTO public.work_plan_template_entries (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Water Heating System', v_nick, v_plan, v_water, 3);
  END IF;
END $$;

-- ── 4. Option lists for the new selects (admin-managed; guarded) ───────────────
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'work_step_fields', v.f, v.val, v.val, true, v.ord, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (VALUES
  ('cooling_system_type', 'Central Air Conditioner', 10),
  ('cooling_system_type', 'Air-Source Heat Pump',    20),
  ('cooling_system_type', 'Ductless Mini-Split',     30),
  ('cooling_system_type', 'Window / Room AC Unit',   40),
  ('cooling_system_type', 'Evaporative Cooler',      50),
  ('cooling_system_fuel_type', 'Gas',      10),
  ('cooling_system_fuel_type', 'Electric', 20),
  ('cooling_system_condition', 'Good', 10),
  ('cooling_system_condition', 'Fair', 20),
  ('cooling_system_condition', 'Poor', 30),
  ('water_heating_system_type', 'Storage Tank',            10),
  ('water_heating_system_type', 'Tankless / On-Demand',    20),
  ('water_heating_system_type', 'Heat Pump Water Heater',  30),
  ('water_heating_system_type', 'Indirect (Boiler)',       40),
  ('water_heating_system_type', 'Solar',                   50),
  ('water_heating_system_fuel_type', 'Gas',      10),
  ('water_heating_system_fuel_type', 'Electric', 20),
  ('water_heating_system_condition', 'Good', 10),
  ('water_heating_system_condition', 'Fair', 20),
  ('water_heating_system_condition', 'Poor', 30)
) AS v(f, val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
   WHERE p.picklist_object='work_step_fields' AND p.picklist_field=v.f AND p.picklist_value=v.val
);

NOTIFY pgrst, 'reload schema';
