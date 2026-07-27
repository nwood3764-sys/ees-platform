-- Assessment systems: Year of Manufacture, drop redundant Fuel Type, and
-- rewrite the Water Heating Type list.
--
-- 1. Year of Manufacture on all three systems. Heating & Cooling already carry
--    a numeric "Model Year"; relabel it to "Year of Manufacture" and add the
--    same field to Water Heating. The old Water Heating "Age" range picklist is
--    superseded by the precise manufacture year (age = current year − it).
-- 2. Fuel Type is redundant: cooling is always electric (no field), and a
--    heating/water-heating system's fuel is implied by its System Type. Drop the
--    Heating and Water Heating Fuel Type fields.
-- 3. Water Heating Type now names the fuel/configuration directly.

DO $$
DECLARE
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
BEGIN
  -- 1a. Relabel Model Year -> Year of Manufacture (heating + cooling).
  UPDATE public.work_step_template_fields
  SET wstf_field_label = 'Year of Manufacture',
      wstf_help_text   = COALESCE(wstf_help_text, 'Year the equipment was manufactured — can be decoded from the serial number if it is not on the label.'),
      wstf_updated_at = now(), wstf_updated_by = v_owner
  WHERE wstf_field_name IN ('heating_model_year','cooling_model_year')
    AND wstf_is_deleted IS NOT TRUE;

  -- 1b. Add Year of Manufacture to Water Heating (idempotent).
  IF NOT EXISTS (
    SELECT 1 FROM public.work_step_template_fields
    WHERE wstf_field_name = 'water_heating_model_year' AND wstf_is_deleted IS NOT TRUE
  ) THEN
    INSERT INTO public.work_step_template_fields
      (wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
       wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required,
       wstf_sort_order, wstf_is_active, wstf_help_text)
    VALUES
      ('', v_owner, v_owner, '6e67c6be-41f8-442c-b73f-260eff541024',
       'Year of Manufacture', 'water_heating_model_year', 'number', false,
       13, true,
       'Year the equipment was manufactured — can be decoded from the serial number if it is not on the label.');
  END IF;

  -- 1c. Retire the redundant Water Heating "Age" range field.
  UPDATE public.work_step_template_fields
  SET wstf_is_deleted = true, wstf_is_active = false,
      wstf_deleted_at = now(), wstf_deleted_by = v_owner,
      wstf_deletion_reason = 'Superseded by Year of Manufacture.'
  WHERE wstf_field_name = 'dhw_age' AND wstf_is_deleted IS NOT TRUE;
  UPDATE public.picklist_values SET picklist_is_active = false
  WHERE picklist_object = 'work_step_fields' AND picklist_field = 'dhw_age';

  -- 2. Drop the Heating and Water Heating Fuel Type fields (fuel implied by type).
  UPDATE public.work_step_template_fields
  SET wstf_is_deleted = true, wstf_is_active = false,
      wstf_deleted_at = now(), wstf_deleted_by = v_owner,
      wstf_deletion_reason = 'Fuel is implied by the System Type; a separate Fuel Type is redundant.'
  WHERE wstf_field_name IN ('heating_system_fuel_type','water_heating_system_fuel_type')
    AND wstf_is_deleted IS NOT TRUE;
  UPDATE public.picklist_values SET picklist_is_active = false
  WHERE picklist_object = 'work_step_fields'
    AND picklist_field IN ('heating_system_fuel_type','water_heating_system_fuel_type');

  -- 3. Water Heating Type -> the seven fuel/configuration-specific options.
  --    Deactivate the prior generic options.
  UPDATE public.picklist_values SET picklist_is_active = false
  WHERE picklist_object = 'work_step_fields' AND picklist_field = 'water_heating_system_type'
    AND picklist_value IN ('Storage Tank','Tankless / On-Demand','Heat Pump Water Heater','Indirect (Boiler)','Solar');

  --    Insert the new options (idempotent by value).
  INSERT INTO public.picklist_values
    (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
  SELECT gen_random_uuid(), 'work_step_fields', 'water_heating_system_type', v.val, v.val, true, v.ord, v_owner
  FROM (VALUES
    ('Storage - Gas', 10),
    ('Storage - Electric', 20),
    ('Storage - Heat Pump', 30),
    ('Storage - Split Heat Pump', 40),
    ('Storage - Boiler', 50),
    ('Tankless - Gas', 60),
    ('Tankless - Electric', 70)
  ) AS v(val, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.picklist_values p2
    WHERE p2.picklist_object = 'work_step_fields' AND p2.picklist_field = 'water_heating_system_type'
      AND p2.picklist_value = v.val
  );
END $$;
