-- Utility Information on the reservation form should inherit from the property
-- record (LEAP models utility data at the property level). Electric Provider
-- already read from the property; repoint Electric Account Number (was building)
-- and "How is this building heated?" (was a typed enrollment picklist) to the
-- property. Add the missing property electric-account-number column first so the
-- page-layout related-field validator passes.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS property_electric_account_number text;
COMMENT ON COLUMN public.properties.property_electric_account_number IS 'Electric utility account number for the property (inherited into program submittals).';

UPDATE page_layout_widgets
SET widget_config = '{"fields":[
      {"name":"property_id.property_electric_utility","type":"related_field","label":"Electric Provider","column":1,"related":{"table":"properties","column":"property_electric_utility","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_electric_account_number","type":"related_field","label":"Electric Account Number","column":2,"related":{"table":"properties","column":"property_electric_account_number","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_heating_fuel_type","type":"related_field","label":"How is this building heated?","column":1,"related":{"table":"properties","column":"property_heating_fuel_type","fk_column":"property_id","column_type":"text"}}
   ]}'::jsonb,
    updated_at = now()
WHERE page_layout_id = '94af9c5b-bd66-43e4-b348-f4781efce547'
  AND is_deleted IS NOT TRUE
  AND widget_type = 'field_group'
  AND widget_title = 'Utility Information';

NOTIFY pgrst, 'reload schema';
