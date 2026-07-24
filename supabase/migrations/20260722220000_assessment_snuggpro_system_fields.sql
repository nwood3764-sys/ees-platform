-- =====================================================================
-- Deepen the three mechanical assessment sections to full SnuggPro depth
-- (Nicholas, 2026-07-22). Adds the equipment-detail and ductwork fields
-- SnuggPro models for HVAC (Heating, Cooling) and DHW (Water Heating),
-- on top of the fields already present.
--
-- All new fields are OPTIONAL (wstf_is_required=false): a boiler has no
-- ducts, a ductless system no ductwork, etc., so these must be skippable.
-- The screen flow lets optional prompts be skipped; the evidence gate only
-- hard-gates the required fields.
--
-- Generic HVAC selects (Upgrade Action, Duct Location/Sealing/Insulation)
-- share one admin-managed option list across Heating and Cooling; DHW Age/
-- Location/Temperature Setting are their own lists.
-- Idempotent: guarded on the first new field per section + per picklist value.
-- =====================================================================

-- ── Option lists ──────────────────────────────────────────────────────────────
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'work_step_fields', v.f, v.val, v.val, true, v.ord, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (VALUES
  ('system_upgrade_action', 'Replace with a newer model',       10),
  ('system_upgrade_action', 'Keep an existing system as is',    20),
  ('system_upgrade_action', 'Remove a system permanently',      30),
  ('system_upgrade_action', 'Install a new non-existing system',40),

  ('duct_location', 'Attic (unconditioned)',                         10),
  ('duct_location', 'Basement (unconditioned)',                      20),
  ('duct_location', 'Intentionally Conditioned Space',               30),
  ('duct_location', 'Crawlspace (unconditioned)',                    40),
  ('duct_location', '50/50 Attic / Basement (both unconditioned)',   50),
  ('duct_location', '50/50 Attic (unconditioned) / Conditioned Space',60),
  ('duct_location', '50/50 Attic / Crawlspace (both unconditioned)', 70),
  ('duct_location', '50/50 Basement (unconditioned) / Conditioned Space',80),
  ('duct_location', '50/50 Crawlspace (unconditioned) / Conditioned Space',90),
  ('duct_location', '70/30 Conditioned Space / Garage (unconditioned)',100),

  ('duct_sealing', '30% - Very leaky',      10),
  ('duct_sealing', '15% - Somewhat leaky',  20),
  ('duct_sealing', '6% - Well sealed',      30),
  ('duct_sealing', '3% - Very tight',       40),
  ('duct_sealing', 'Measured (CFM25)',      50),

  ('duct_insulation', 'None',                  10),
  ('duct_insulation', 'Duct board 1"',         20),
  ('duct_insulation', 'Duct board 1.5"',       30),
  ('duct_insulation', 'Duct board 2"',         40),
  ('duct_insulation', 'Fiberglass 1.25"',      50),
  ('duct_insulation', 'Fiberglass 2"',         60),
  ('duct_insulation', 'Fiberglass 2.5"',       70),
  ('duct_insulation', 'Reflective bubble wrap',80),

  ('dhw_age', '0-5',   10),
  ('dhw_age', '6-10',  20),
  ('dhw_age', '11-15', 30),
  ('dhw_age', '16-20', 40),
  ('dhw_age', '21-25', 50),
  ('dhw_age', '26-30', 60),
  ('dhw_age', '31-35', 70),
  ('dhw_age', '36+',   80),

  ('dhw_location', 'Indoors and within heated area', 10),
  ('dhw_location', 'Garage or Unconditioned Space',  20),
  ('dhw_location', 'Outbuilding',                    30),

  ('dhw_settings', 'Low (120-130°F)',      10),
  ('dhw_settings', 'Medium (130-140°F)',   20),
  ('dhw_settings', 'High (140-150°F)',     30),
  ('dhw_settings', 'Very High (150°+F)',   40)
) AS v(f, val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
   WHERE p.picklist_object='work_step_fields' AND p.picklist_field=v.f AND p.picklist_value=v.val
);

-- ── Fields ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_nick  uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_heat  uuid;
  v_cool  uuid;
  v_water uuid;
BEGIN
  SELECT id INTO v_heat  FROM public.work_step_templates WHERE wst_name='Heating System'       AND wst_is_deleted IS NOT TRUE ORDER BY wst_created_at LIMIT 1;
  SELECT id INTO v_cool  FROM public.work_step_templates WHERE wst_name='Cooling System'        AND wst_is_deleted IS NOT TRUE ORDER BY wst_created_at LIMIT 1;
  SELECT id INTO v_water FROM public.work_step_templates WHERE wst_name='Water Heating System'  AND wst_is_deleted IS NOT TRUE ORDER BY wst_created_at LIMIT 1;

  IF v_heat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_heat AND wstf_field_name='system_upgrade_action' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
    VALUES
      ('', v_heat, 'Upgrade Action',           'system_upgrade_action',   'select', false, NULL,    6,  v_nick, v_nick),
      ('', v_heat, 'Total Load %',             'heating_total_load_pct',  'number', false, '%',     7,  v_nick, v_nick),
      ('', v_heat, 'Capacity',                 'heating_capacity',        'text',   false, NULL,    8,  v_nick, v_nick),
      ('', v_heat, 'Model Year',               'heating_model_year',      'number', false, NULL,    9,  v_nick, v_nick),
      ('', v_heat, 'System Efficiency (AFUE)', 'heating_efficiency_afue', 'number', false, '%',     10, v_nick, v_nick),
      ('', v_heat, 'Output Capacity',          'heating_output_capacity', 'number', false, 'BTU/h', 11, v_nick, v_nick),
      ('', v_heat, 'Manufacturer',             'heating_manufacturer',    'text',   false, NULL,    12, v_nick, v_nick),
      ('', v_heat, 'Duct Location',            'duct_location',           'select', false, NULL,    13, v_nick, v_nick),
      ('', v_heat, 'Duct Sealing',             'duct_sealing',            'select', false, NULL,    14, v_nick, v_nick),
      ('', v_heat, 'Duct Insulation',          'duct_insulation',         'select', false, NULL,    15, v_nick, v_nick),
      ('', v_heat, 'Duct Leakage (CFM25)',     'duct_leakage_cfm25',      'number', false, 'CFM25', 16, v_nick, v_nick),
      ('', v_heat, 'Duct R-Value',             'duct_r_value',            'number', false, NULL,    17, v_nick, v_nick);
  END IF;

  IF v_cool IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_cool AND wstf_field_name='system_upgrade_action' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
    VALUES
      ('', v_cool, 'Upgrade Action',           'system_upgrade_action',   'select', false, NULL,    6,  v_nick, v_nick),
      ('', v_cool, 'Total Load %',             'cooling_total_load_pct',  'number', false, '%',     7,  v_nick, v_nick),
      ('', v_cool, 'Capacity',                 'cooling_capacity',        'text',   false, NULL,    8,  v_nick, v_nick),
      ('', v_cool, 'Model Year',               'cooling_model_year',      'number', false, NULL,    9,  v_nick, v_nick),
      ('', v_cool, 'System Efficiency (SEER)', 'cooling_efficiency_seer', 'number', false, NULL,    10, v_nick, v_nick),
      ('', v_cool, 'Output Capacity',          'cooling_output_capacity', 'number', false, 'BTU/h', 11, v_nick, v_nick),
      ('', v_cool, 'Manufacturer',             'cooling_manufacturer',    'text',   false, NULL,    12, v_nick, v_nick),
      ('', v_cool, 'Duct Location',            'duct_location',           'select', false, NULL,    13, v_nick, v_nick),
      ('', v_cool, 'Duct Sealing',             'duct_sealing',            'select', false, NULL,    14, v_nick, v_nick),
      ('', v_cool, 'Duct Insulation',          'duct_insulation',         'select', false, NULL,    15, v_nick, v_nick),
      ('', v_cool, 'Duct Leakage (CFM25)',     'duct_leakage_cfm25',      'number', false, 'CFM25', 16, v_nick, v_nick),
      ('', v_cool, 'Duct R-Value',             'duct_r_value',            'number', false, NULL,    17, v_nick, v_nick);
  END IF;

  IF v_water IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_water AND wstf_field_name='dhw_age' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
    VALUES
      ('', v_water, '% of Total DHW Load',     'dhw_total_load_pct',        'number', false, '%',  6,  v_nick, v_nick),
      ('', v_water, 'Age',                     'dhw_age',                   'select', false, NULL, 7,  v_nick, v_nick),
      ('', v_water, 'Location',                'dhw_location',              'select', false, NULL, 8,  v_nick, v_nick),
      ('', v_water, 'Temperature Setting',     'dhw_settings',              'select', false, NULL, 9,  v_nick, v_nick),
      ('', v_water, 'Manufacturer',            'water_heating_manufacturer','text',   false, NULL, 10, v_nick, v_nick);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
