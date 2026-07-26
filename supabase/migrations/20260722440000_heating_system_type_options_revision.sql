-- =====================================================================
-- Heating System Type revision (Nicholas, 2026-07-22): remove the generic
-- "Forced Air Furnace" and standalone "Central Boiler"; "Electric Furnace"
-- becomes "Forced Air Electric Furnace"; "Hydronic Baseboard" becomes
-- "Hydronic Baseboard - Central Boiler". Removals are deactivations so an
-- admin can restore them. Final list: Forced Air Gas Furnace, Forced Air
-- Electric Furnace, Electric Resistance Baseboard, Hydronic Baseboard -
-- Central Boiler, Heat Pump.
-- =====================================================================
UPDATE public.picklist_values SET picklist_is_active=false
 WHERE picklist_object='work_step_fields' AND picklist_field='heating_system_type'
   AND picklist_value IN ('Forced Air Furnace','Central Boiler');

UPDATE public.picklist_values
   SET picklist_value='Forced Air Electric Furnace', picklist_label='Forced Air Electric Furnace'
 WHERE picklist_object='work_step_fields' AND picklist_field='heating_system_type'
   AND picklist_value='Electric Furnace';

UPDATE public.picklist_values
   SET picklist_value='Hydronic Baseboard - Central Boiler', picklist_label='Hydronic Baseboard - Central Boiler'
 WHERE picklist_object='work_step_fields' AND picklist_field='heating_system_type'
   AND picklist_value='Hydronic Baseboard';

NOTIFY pgrst, 'reload schema';

-- Heat Pump splits into Ducted / Ductless (Nicholas, same session).
UPDATE public.picklist_values
   SET picklist_value='Heat Pump - Ducted', picklist_label='Heat Pump - Ducted'
 WHERE picklist_object='work_step_fields' AND picklist_field='heating_system_type'
   AND picklist_value='Heat Pump';

INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'work_step_fields','heating_system_type','Heat Pump - Ductless','Heat Pump - Ductless', true, 75, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values
   WHERE picklist_object='work_step_fields' AND picklist_field='heating_system_type'
     AND picklist_value='Heat Pump - Ductless');
