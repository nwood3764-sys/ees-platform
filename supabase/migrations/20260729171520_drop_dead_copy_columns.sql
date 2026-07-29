-- Retire the now-dead duplicated columns on enrollments and incentive_applications.
-- Every reader was re-pointed to the parent in migration 20260729171036 + the client
-- code shipped in that PR, so these columns are provably unreferenced (layouts show
-- parent references, the create-copy is stopped, functions/reports/services read the
-- parent). This is the irreversible cleanup step, run AFTER that code is live.
--
-- The three ia_business_entity_* fields are replaced by 2-hop Inherited Fields
-- (application -> property -> account): the physical column is dropped, then a
-- field_metadata 'inherited' definition is registered under the same name, so the
-- existing layout widget resolves live from the owner account.

-- 1. Enrollments — 23 columns now inherited live from the Property.
ALTER TABLE public.enrollments
  DROP COLUMN IF EXISTS enrollment_hud_property_id,
  DROP COLUMN IF EXISTS enrollment_property_name,
  DROP COLUMN IF EXISTS enrollment_site_address,
  DROP COLUMN IF EXISTS enrollment_city,
  DROP COLUMN IF EXISTS enrollment_state,
  DROP COLUMN IF EXISTS enrollment_zip,
  DROP COLUMN IF EXISTS enrollment_county,
  DROP COLUMN IF EXISTS enrollment_total_units,
  DROP COLUMN IF EXISTS enrollment_assisted_units,
  DROP COLUMN IF EXISTS enrollment_property_category,
  DROP COLUMN IF EXISTS enrollment_number_of_buildings,
  DROP COLUMN IF EXISTS enrollment_owner_organization,
  DROP COLUMN IF EXISTS enrollment_owner_phone,
  DROP COLUMN IF EXISTS enrollment_owner_email,
  DROP COLUMN IF EXISTS enrollment_owner_fein,
  DROP COLUMN IF EXISTS enrollment_management_agent,
  DROP COLUMN IF EXISTS enrollment_management_phone,
  DROP COLUMN IF EXISTS enrollment_management_email,
  DROP COLUMN IF EXISTS enrollment_hud_contract_number,
  DROP COLUMN IF EXISTS enrollment_hud_tracs_status,
  DROP COLUMN IF EXISTS enrollment_hud_contract_expiration,
  DROP COLUMN IF EXISTS enrollment_is_202_811,
  DROP COLUMN IF EXISTS enrollment_is_opportunity_zone;

-- 2. Incentive applications — 21 building/property/opportunity mirrors + 3 account
--    business-entity fields (which become Inherited Fields below).
ALTER TABLE public.incentive_applications
  DROP COLUMN IF EXISTS ia_building_square_footage,
  DROP COLUMN IF EXISTS ia_total_building_square_footage,
  DROP COLUMN IF EXISTS ia_total_floors_in_building,
  DROP COLUMN IF EXISTS ia_year_the_building_was_built,
  DROP COLUMN IF EXISTS ia_multifamily_of_units_in_building,
  DROP COLUMN IF EXISTS ia_installation_address_street,
  DROP COLUMN IF EXISTS ia_installation_address_city,
  DROP COLUMN IF EXISTS ia_installation_address_state,
  DROP COLUMN IF EXISTS ia_installation_address_zip,
  DROP COLUMN IF EXISTS ia_electric_provider,
  DROP COLUMN IF EXISTS ia_natural_gas_provider,
  DROP COLUMN IF EXISTS ia_other_heating_fuel_provider,
  DROP COLUMN IF EXISTS ia_total_number_of_units,
  DROP COLUMN IF EXISTS ia_total_number_of_occupied_units,
  DROP COLUMN IF EXISTS ia_building_owner_name,
  DROP COLUMN IF EXISTS ia_building_owner_name_ira,
  DROP COLUMN IF EXISTS ia_building_owner_email_address,
  DROP COLUMN IF EXISTS ia_building_owner_office_phone,
  DROP COLUMN IF EXISTS ia_income_qualified_confirmation_code,
  DROP COLUMN IF EXISTS ia_electric_account_number,
  DROP COLUMN IF EXISTS ia_natural_gas_account_number,
  DROP COLUMN IF EXISTS ia_business_entity_name,
  DROP COLUMN IF EXISTS ia_business_entity_phone_number,
  DROP COLUMN IF EXISTS ia_business_entity_email;

-- 3. Register the 2-hop Inherited Fields for the owner account (business entity).
--    Physical columns are gone (dropped above), so describe_object_columns emits
--    these as virtual columns and the placed layout widgets resolve live.
INSERT INTO public.field_metadata
  (fm_record_number, fm_object, fm_column, fm_label, fm_field_kind, fm_display_type, fm_inherit_config, fm_is_custom)
VALUES
  ('', 'incentive_applications', 'ia_business_entity_name', 'Business Entity Name', 'inherited', 'text',
   '{"hops":[{"fk":"property_id","table":"properties"},{"fk":"property_account_id","table":"accounts"}],"source_column":"account_name","source_data_type":"text","display_type":"text"}'::jsonb, true),
  ('', 'incentive_applications', 'ia_business_entity_phone_number', 'Business Entity Phone', 'inherited', 'phone',
   '{"hops":[{"fk":"property_id","table":"properties"},{"fk":"property_account_id","table":"accounts"}],"source_column":"account_phone","source_data_type":"text","display_type":"phone"}'::jsonb, true),
  ('', 'incentive_applications', 'ia_business_entity_email', 'Business Entity Email', 'inherited', 'email',
   '{"hops":[{"fk":"property_id","table":"properties"},{"fk":"property_account_id","table":"accounts"}],"source_column":"account_email","source_data_type":"text","display_type":"email"}'::jsonb, true)
ON CONFLICT (fm_object, fm_column) DO UPDATE SET
  fm_field_kind = 'inherited', fm_display_type = EXCLUDED.fm_display_type,
  fm_inherit_config = EXCLUDED.fm_inherit_config, fm_is_deleted = false, fm_updated_at = now();

NOTIFY pgrst, 'reload schema';
