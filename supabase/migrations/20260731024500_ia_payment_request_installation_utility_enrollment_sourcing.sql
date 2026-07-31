-- Re-source the Project Payment Request's Installation Building + Utility fields
-- to match the enrollment reservation layout exactly (the sources that actually
-- populate):
--   Installation Building — Contact Name/Email/Phone from the signer contact
--   (ia_signer_contact_id, backfilled from the opportunity's authorized signer);
--   Occupied Units editable (ia_occupied_units); units/sqft/floors/year/income
--   code from the building (building_total_units, building_square_footage,
--   building_stories_of_building, building_year_built, ira_confirmation_code_lea);
--   address/owner from the property.
--   Utility — every field pulled from the building (electric utility + account,
--   heating fuel type, gas utility + account, other heating fuel provider).
-- Only the two field_group widgets change; the rest of PL-00382 is untouched.

DO $$
DECLARE
  v_layout uuid; v_s5 uuid; v_s6 uuid;
BEGIN
  SELECT pl.id INTO v_layout FROM public.page_layouts pl
  JOIN public.picklist_values rt ON rt.id = pl.record_type_id
  WHERE pl.page_layout_object='incentive_applications'
    AND rt.picklist_value='WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST' AND pl.is_deleted IS NOT TRUE;
  IF v_layout IS NULL THEN RETURN; END IF;

  SELECT id INTO v_s5 FROM public.page_layout_sections
   WHERE page_layout_id=v_layout AND section_label='Installation Building Information' AND is_deleted IS NOT TRUE;
  SELECT id INTO v_s6 FROM public.page_layout_sections
   WHERE page_layout_id=v_layout AND section_label='Utility Information' AND is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets SET updated_at=now(), widget_config =
    '{"fields": [{"name": "property_id.property_hud_owner_org", "type": "related_field", "label": "Business Entity Name", "column": 1, "related": {"table": "properties", "column": "property_hud_owner_org", "fk_column": "property_id", "column_type": "text"}}, {"name": "ia_signer_contact_id", "type": "lookup", "label": "Contact Name", "column": 2, "lookup_table": "contacts", "lookup_field": "contact_name"}, {"name": "ia_signer_contact_id.contact_email", "type": "related_field", "label": "Email", "column": 1, "related": {"table": "contacts", "column": "contact_email", "fk_column": "ia_signer_contact_id", "column_type": "email"}}, {"name": "ia_signer_contact_id.contact_phone", "type": "related_field", "label": "Phone Number", "column": 2, "related": {"table": "contacts", "column": "contact_phone", "fk_column": "ia_signer_contact_id", "column_type": "phone"}}, {"name": "property_id.property_hud_owner_org", "type": "related_field", "label": "Building Owner Name", "column": 1, "related": {"table": "properties", "column": "property_hud_owner_org", "fk_column": "property_id", "column_type": "text"}}, {"name": "property_id.property_street", "type": "related_field", "label": "Installation Address", "column": 1, "related": {"table": "properties", "column": "property_street", "fk_column": "property_id", "column_type": "text"}}, {"name": "property_id.property_city", "type": "related_field", "label": "City", "column": 1, "related": {"table": "properties", "column": "property_city", "fk_column": "property_id", "column_type": "text"}}, {"name": "property_id.property_state", "type": "related_field", "label": "State", "column": 2, "related": {"table": "properties", "column": "property_state", "fk_column": "property_id", "column_type": "text"}, "format": "us_state_abbrev"}, {"name": "property_id.property_zip", "type": "related_field", "label": "Zip", "column": 1, "related": {"table": "properties", "column": "property_zip", "fk_column": "property_id", "column_type": "text"}}, {"name": "building_id.building_total_units", "type": "related_field", "label": "Total Number of Units", "column": 1, "related": {"table": "buildings", "column": "building_total_units", "fk_column": "building_id", "column_type": "number"}}, {"name": "ia_occupied_units", "type": "integer", "label": "Total Number of Occupied Units", "column": 2}, {"name": "building_id.building_square_footage", "type": "related_field", "label": "Total Building Square Footage", "column": 1, "related": {"table": "buildings", "column": "building_square_footage", "fk_column": "building_id", "column_type": "number"}}, {"name": "building_id.building_stories_of_building", "type": "related_field", "label": "Total Floors in Building", "column": 2, "related": {"table": "buildings", "column": "building_stories_of_building", "fk_column": "building_id", "column_type": "number"}}, {"name": "building_id.building_year_built", "type": "related_field", "label": "Year the Building was Built", "column": 1, "related": {"table": "buildings", "column": "building_year_built", "fk_column": "building_id", "column_type": "text"}}, {"name": "ia_income_level", "type": "picklist", "label": "Which income level is your customer approved at?", "column": 2, "display": "radio"}, {"name": "building_id.ira_confirmation_code_lea", "type": "related_field", "label": "Income-Qualified Confirmation Code", "column": 1, "related": {"table": "buildings", "column": "ira_confirmation_code_lea", "fk_column": "building_id", "column_type": "text"}}, {"name": "ia_total_project_cost", "type": "currency", "label": "Total Project Cost", "column": 2}]}'::jsonb
  WHERE page_layout_id=v_layout AND section_id=v_s5 AND widget_type='field_group' AND is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets SET updated_at=now(), widget_config =
    '{"fields": [{"name": "building_id.building_electric_utility", "type": "related_field", "label": "Electric Provider", "column": 1, "related": {"table": "buildings", "column": "building_electric_utility", "fk_column": "building_id", "column_type": "text"}}, {"name": "building_id.building_electric_account_number", "type": "related_field", "label": "Electric Account Number", "column": 2, "related": {"table": "buildings", "column": "building_electric_account_number", "fk_column": "building_id", "column_type": "text"}}, {"name": "building_id.building_heating_fuel_type", "type": "related_field", "label": "How is this building heated?", "column": 1, "related": {"table": "buildings", "column": "building_heating_fuel_type", "fk_column": "building_id", "column_type": "picklist"}}, {"name": "building_id.building_gas_utility", "type": "related_field", "label": "Natural Gas Provider", "column": 2, "related": {"table": "buildings", "column": "building_gas_utility", "fk_column": "building_id", "column_type": "text"}}, {"name": "building_id.building_gas_account_number", "type": "related_field", "label": "Natural Gas Account Number", "column": 1, "related": {"table": "buildings", "column": "building_gas_account_number", "fk_column": "building_id", "column_type": "text"}}, {"name": "building_id.building_heating_fuel_provider", "type": "related_field", "label": "Other Heating Fuel Provider", "column": 2, "related": {"table": "buildings", "column": "building_heating_fuel_provider", "fk_column": "building_id", "column_type": "text"}}, {"name": "ia_other_account_number", "type": "text", "label": "Other Account Number", "column": 1}]}'::jsonb
  WHERE page_layout_id=v_layout AND section_id=v_s6 AND widget_type='field_group' AND is_deleted IS NOT TRUE;
END $$;
