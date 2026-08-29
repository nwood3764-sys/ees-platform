-- Vehicle Inspection work order type.
--
-- The technician-creatable family named in fieldMobileService.js (Building
-- Access, Post Notice of Entry, Incident Report, Vehicle Inspection, Damaged
-- Equipment, Material Delivery) gains its Vehicle Inspection member. The
-- checklist is exactly the fourteen items Nicholas specified and nothing else.
--
-- Purpose-built artifacts, none of them shared with another work type:
--   * work_orders record type  VEHICLE-INSPECTION
--   * work type                Vehicle Inspection
--   * work plan template       Vehicle Inspection - Standard
--   * work step template       Vehicle Equipment and Documents Check
--   * 15 step template fields  the vehicle inspected + one per checklist item
--
-- This is NOT the Fleet pre-trip / return inspection
-- (vehicle_inspection_item_templates, VIT-00001..32, driven from the LEAP Pad
-- Vehicle Inspection screen). That one checks the vehicle itself -- tires, oil,
-- damage, dash alerts. This one checks what is CARRIED IN the vehicle. Two
-- different questions, two artifacts; neither was reshaped to serve the other.
--
-- Each checklist item is a required `photo` field that opts into
-- allow_not_present, which is the mechanism the evidence gate already
-- understands: photograph the item, or mark it Not Present. A missing item is
-- therefore RECORDED rather than blocking the technician from finishing --
-- documentation is never blocked -- and the gap is queryable in
-- work_step_field_values instead of living in someone's memory.

-- 1. Which vehicle was inspected.
-- A new work step field type, built the way 'key_source' and 'user_multiselect'
-- were: a picker over real records that stores readable text. Without it an
-- inspection record cannot say which truck it describes.
ALTER TABLE public.work_step_template_fields
  DROP CONSTRAINT work_step_template_fields_wstf_field_type_check;
ALTER TABLE public.work_step_template_fields
  ADD CONSTRAINT work_step_template_fields_wstf_field_type_check
  CHECK (wstf_field_type = ANY (ARRAY[
    'number'::text, 'text'::text, 'select'::text,
    'user_multiselect'::text, 'key_source'::text, 'photo'::text,
    'vehicle'::text
  ]));

-- 2. Work order record type.
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_by, picklist_description)
VALUES
  ('work_orders', 'record_type', 'VEHICLE-INSPECTION', 'Vehicle Inspection',
   true, 666, 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'Work order documenting the required equipment and documents carried in a company vehicle.');

-- 3-5. Work step template, its fields, the work plan template, and the work type.
WITH new_step AS (
  INSERT INTO public.work_step_templates (
    wst_record_number, wst_name, wst_description,
    wst_owner, wst_created_by,
    wst_required_evidence_type_id, wst_photos_required_count, wst_is_screen_flow,
    wst_assigned_owner_role_id, wst_verifier_role_id, wst_is_active
  ) VALUES (
    '', 'Vehicle Equipment and Documents Check',
    'Walk the vehicle and photograph each required item. Anything not in the vehicle is marked Not Present so the gap is on the record.',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    '16130b3e-e416-4d92-bf23-ec0f8aeee3e1',
    0, true,
    '4a93279e-f88e-4f12-9db8-6bd4e0e80262',
    '7495dd05-ec12-4dc0-ad07-db53daf78487',
    true
  ) RETURNING id
),
step_fields AS (
  INSERT INTO public.work_step_template_fields (
    wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
    wstf_field_label, wstf_field_name, wstf_field_type,
    wstf_is_required, wstf_allow_not_present, wstf_sort_order, wstf_help_text
  )
  SELECT '', 'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
         new_step.id, f.label, f.name, f.ftype, true, f.not_present, f.ord, f.help
  FROM new_step, (VALUES
    ('Vehicle Inspected',   'vehicle_inspected',        'vehicle', false,  1, 'Which vehicle are you inspecting?'),
    ('First Aid Kit',       'vi_first_aid_kit',         'photo',   true,   2, 'Photograph the first aid kit.'),
    ('Fuel Card',           'vi_fuel_card',             'photo',   true,   3, 'Photograph the fuel card.'),
    ('Vehicle Registration','vi_vehicle_registration',  'photo',   true,   4, 'Photograph the vehicle registration.'),
    ('Vehicle Insurance',   'vi_vehicle_insurance',     'photo',   true,   5, 'Photograph the proof of insurance card.'),
    ('Trunk Cables',        'vi_trunk_cables',          'photo',   true,   6, 'Photograph the trunk cables.'),
    ('Cell Phone Holder',   'vi_cell_phone_holder',     'photo',   true,   7, 'Photograph the cell phone holder.'),
    ('Cell Phone Charger',  'vi_cell_phone_charger',    'photo',   true,   8, 'Photograph the cell phone charger.'),
    ('Radio Charger',       'vi_radio_charger',         'photo',   true,   9, 'Photograph the radio charger.'),
    ('Radio Holder',        'vi_radio_holder',          'photo',   true,  10, 'Photograph the radio holder.'),
    ('Door Wedge',          'vi_door_wedge',            'photo',   true,  11, 'Photograph the door wedge.'),
    ('Booties',             'vi_booties',               'photo',   true,  12, 'Photograph the booties.'),
    ('Disposable Gloves',   'vi_disposable_gloves',     'photo',   true,  13, 'Photograph the disposable gloves.'),
    ('Fire Extinguisher',   'vi_fire_extinguisher',     'photo',   true,  14, 'Photograph the fire extinguisher.'),
    ('Umbrella',            'vi_umbrella',              'photo',   true,  15, 'Photograph the umbrella.')
  ) AS f(label, name, ftype, not_present, ord, help)
  RETURNING 1
),
new_plan AS (
  INSERT INTO public.work_plan_templates (
    wpt_record_number, wpt_name, wpt_description,
    wpt_owner, wpt_created_by, wpt_is_active, wpt_allow_any_order
  ) VALUES (
    '', 'Vehicle Inspection - Standard',
    'Records the vehicle inspected and the fourteen required equipment and document items carried in it. Each item is photographed, or explicitly marked Not Present.',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    true, false
  ) RETURNING id
),
new_entry AS (
  INSERT INTO public.work_plan_template_entries (
    wpte_record_number, wpte_name, wpte_created_by,
    work_plan_template_id, work_step_template_id, wpte_execution_order
  )
  SELECT '', 'Vehicle Equipment and Documents Check',
         'c5a01ec8-960f-42ab-8a9e-a49822de89af', new_plan.id, new_step.id, 1
  FROM new_plan, new_step
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
  '', 'Vehicle Inspection',
  'Documents the required equipment and documents carried in a company vehicle: first aid kit, fuel card, registration, insurance, trunk cables, cell phone holder and charger, radio charger and holder, door wedge, booties, disposable gloves, fire extinguisher, and umbrella. Created by technicians in the field.',
  'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af', true,
  15, 5, true,
  new_plan.id,
  (SELECT id FROM public.picklist_values
    WHERE picklist_object='work_orders' AND picklist_field='record_type'
      AND picklist_value='VEHICLE-INSPECTION')
FROM new_plan;

-- 6. Assert what was built, rather than assume it.
DO $$
DECLARE
  v_wt   public.work_types;
  v_n    integer;
BEGIN
  SELECT * INTO v_wt FROM public.work_types
   WHERE work_type_name = 'Vehicle Inspection' AND work_type_is_deleted IS NOT TRUE;

  IF v_wt.id IS NULL THEN
    RAISE EXCEPTION 'Vehicle Inspection work type was not created.';
  END IF;
  IF v_wt.work_type_is_technician_creatable IS NOT TRUE THEN
    RAISE EXCEPTION 'Vehicle Inspection is not technician-creatable - it would never appear in the LEAP Pad Create Work Order menu.';
  END IF;
  IF v_wt.work_type_default_work_plan_template_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle Inspection has no default work plan template - create_technician_work_order refuses such a work type.';
  END IF;
  IF v_wt.work_type_default_work_order_record_type IS NULL THEN
    RAISE EXCEPTION 'Vehicle Inspection has no default work order record type.';
  END IF;

  SELECT count(*) INTO v_n
    FROM public.work_plan_template_entries e
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND e.wpte_is_deleted IS NOT TRUE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected 1 step in the Vehicle Inspection plan, found %.', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.work_plan_template_entries e
    JOIN public.work_step_template_fields f ON f.work_step_template_id = e.work_step_template_id
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND e.wpte_is_deleted IS NOT TRUE AND f.wstf_is_deleted IS NOT TRUE
     AND f.wstf_field_type = 'photo'
     AND f.wstf_is_required IS TRUE AND f.wstf_allow_not_present IS TRUE;
  IF v_n <> 14 THEN
    RAISE EXCEPTION 'Expected 14 required, not-present-capable checklist items, found %.', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.work_plan_template_entries e
    JOIN public.work_step_template_fields f ON f.work_step_template_id = e.work_step_template_id
   WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
     AND e.wpte_is_deleted IS NOT TRUE AND f.wstf_is_deleted IS NOT TRUE
     AND f.wstf_field_type = 'vehicle' AND f.wstf_is_required IS TRUE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 required vehicle field, found %.', v_n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.work_plan_template_entries e
      JOIN public.work_step_templates s ON s.id = e.work_step_template_id
     WHERE e.work_plan_template_id = v_wt.work_type_default_work_plan_template_id
       AND e.wpte_is_deleted IS NOT TRUE AND s.wst_is_screen_flow IS TRUE
  ) THEN
    RAISE EXCEPTION 'The Vehicle Inspection step is not a screen flow - its photo fields would render as text boxes.';
  END IF;
END $$;
