-- Water Heating Type: add Propane and Fuel Oil coverage (SnuggPro carries both
-- as fuels). Fuel-oil tankless isn't a real product, so oil is storage-only.
-- Renumber the list so all Storage options sort before all Tankless options.

DO $$
DECLARE
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  r RECORD;
BEGIN
  -- Add the three new options (idempotent by value; reactivate if present).
  FOR r IN
    SELECT * FROM (VALUES
      ('Storage - Propane', 20),
      ('Storage - Fuel Oil', 70),
      ('Tankless - Propane', 90)
    ) AS t(val, ord)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.picklist_values
      WHERE picklist_object='work_step_fields' AND picklist_field='water_heating_system_type'
        AND picklist_value = r.val
    ) THEN
      UPDATE public.picklist_values
      SET picklist_is_active = true, picklist_sort_order = r.ord
      WHERE picklist_object='work_step_fields' AND picklist_field='water_heating_system_type'
        AND picklist_value = r.val;
    ELSE
      INSERT INTO public.picklist_values
        (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
      VALUES
        (gen_random_uuid(), 'work_step_fields', 'water_heating_system_type', r.val, r.val, true, r.ord, v_owner);
    END IF;
  END LOOP;

  -- Renumber the existing options into the final clean order.
  FOR r IN
    SELECT * FROM (VALUES
      ('Storage - Gas', 10),
      ('Storage - Electric', 30),
      ('Storage - Heat Pump', 40),
      ('Storage - Split Heat Pump', 50),
      ('Storage - Boiler', 60),
      ('Tankless - Gas', 80),
      ('Tankless - Electric', 100)
    ) AS t(val, ord)
  LOOP
    UPDATE public.picklist_values
    SET picklist_sort_order = r.ord
    WHERE picklist_object='work_step_fields' AND picklist_field='water_heating_system_type'
      AND picklist_value = r.val AND picklist_is_active = true;
  END LOOP;
END $$;
