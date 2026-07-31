-- Utility Information is per-building, not per-property: a property can have many
-- buildings, each with its own electric account number. Repoint all three
-- Utility Information fields to the building record. building_heating_fuel_type
-- is a picklist (uuid), so wire it as column_type=picklist so the renderer shows
-- the label. Drop the superseded property_electric_account_number column added
-- in the prior (reverted) property-inheritance change; it holds no data.
UPDATE page_layout_widgets
SET widget_config = '{"fields":[
      {"name":"building_id.building_electric_utility","type":"related_field","label":"Electric Provider","column":1,"related":{"table":"buildings","column":"building_electric_utility","fk_column":"building_id","column_type":"text"}},
      {"name":"building_id.building_electric_account_number","type":"related_field","label":"Electric Account Number","column":2,"related":{"table":"buildings","column":"building_electric_account_number","fk_column":"building_id","column_type":"text"}},
      {"name":"building_id.building_heating_fuel_type","type":"related_field","label":"How is this building heated?","column":1,"related":{"table":"buildings","column":"building_heating_fuel_type","fk_column":"building_id","column_type":"picklist"}}
   ]}'::jsonb,
    updated_at = now()
WHERE page_layout_id = '94af9c5b-bd66-43e4-b348-f4781efce547'
  AND is_deleted IS NOT TRUE
  AND widget_type = 'field_group'
  AND widget_title = 'Utility Information';

ALTER TABLE public.properties DROP COLUMN IF EXISTS property_electric_account_number;

NOTIFY pgrst, 'reload schema';
