-- =====================================================================
-- Dependent-lookup foundation: contacts filtered by related accounts.
--
-- Used by the property record detail Site Contact picker so the dropdown
-- shows only contacts associated with the property's owner account
-- and/or managing account, rather than every contact in the system.
--
-- Architecture: declarative `lookup_dependency` config on a field_group
-- field. The frontend reads the spec, gathers the dependency field
-- values from the current draft, and calls this RPC. The result becomes
-- the dropdown options. Extensible — `kind` identifies which RPC to
-- invoke; future kinds (e.g. contacts_for_opportunity) add new RPCs
-- without changing the lookup_dependency schema shape.
-- =====================================================================

-- ---------------------------------------------------------------------
-- RPC: list_contacts_for_accounts
--
-- Returns the set of contacts associated with any of the given accounts.
-- A contact is associated with an account when EITHER:
--   * contacts.contact_account_id = account_id (primary account), OR
--   * an active row exists in account_contact_relations linking them.
--
-- p_include_contact_id is a fallback escape hatch: if the host record
-- already references a contact that isn't currently associated with the
-- given accounts (data inconsistency from history), include it anyway
-- so the dropdown can render the existing value. Caller passes the
-- current FK value when entering edit mode.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_contacts_for_accounts(
  p_account_ids uuid[],
  p_include_contact_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, contact_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT c.id, c.contact_name
    FROM contacts c
   WHERE NOT c.contact_is_deleted
     AND (
       (p_account_ids IS NOT NULL AND array_length(p_account_ids, 1) > 0
         AND c.contact_account_id = ANY(p_account_ids))
       OR EXISTS (
         SELECT 1
           FROM account_contact_relations acr
          WHERE acr.contact_id = c.id
            AND acr.account_id = ANY(p_account_ids)
            AND acr.acr_is_active = true
            AND NOT acr.acr_is_deleted
       )
       OR (p_include_contact_id IS NOT NULL AND c.id = p_include_contact_id)
     )
   ORDER BY c.contact_name;
$$;

COMMENT ON FUNCTION list_contacts_for_accounts(uuid[], uuid)
IS 'Dependent-lookup helper for the Site Contact picker. Returns contacts whose contact_account_id is in the given list OR who have an active account_contact_relations row to any of those accounts. p_include_contact_id forces a specific contact into the result for backward compatibility when the saved value predates account-based filtering.';

GRANT EXECUTE ON FUNCTION list_contacts_for_accounts(uuid[], uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Update widget_configs for the Site Contact field on the 4 properties
-- page layouts. Adds the `lookup_dependency` clause pointing at the
-- existing parent-account fields. Each layout depends on whichever of
-- property_account_id / property_managing_account_id appears on it.
--
-- Note: lookup_field rewritten only — table+field stay as contacts+
-- contact_name so the fallback in case the RPC is unavailable still
-- shows a readable label.
-- ---------------------------------------------------------------------

-- Layout: Multifamily (widget 77171b16) — has both account fields
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','property_name','label','Name','required',true),
    jsonb_build_object('name','property_aka_name','label','AKA Name'),
    jsonb_build_object('name','property_website','label','Website'),
    jsonb_build_object('name','property_account_id','type','lookup','label','Property Owner','required',true,'lookup_field','account_name','lookup_table','accounts'),
    jsonb_build_object('name','property_managing_account_id','type','lookup','label','Property Management Company','lookup_field','account_name','lookup_table','accounts'),
    jsonb_build_object('name','property_primary_contact_id','type','lookup','label','Site Contact','lookup_field','contact_name','lookup_table','contacts',
      'lookup_dependency', jsonb_build_object(
        'kind','contacts_for_accounts',
        'depends_on', jsonb_build_array('property_account_id','property_managing_account_id')
      ))
  )
), updated_at = now()
WHERE id = '77171b16-7595-4297-b58c-fde1594d17f2';

-- Layout: Other (widget d8e4e4af) — has both account fields, longer field list
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','property_name','label','Name','required',true),
    jsonb_build_object('name','property_account_id','type','lookup','label','Property Owner','required',true,'lookup_field','account_name','lookup_table','accounts'),
    jsonb_build_object('name','property_managing_account_id','type','lookup','label','Property Management Company','lookup_field','account_name','lookup_table','accounts'),
    jsonb_build_object('name','property_primary_contact_id','type','lookup','label','Site Contact','lookup_field','contact_name','lookup_table','contacts',
      'lookup_dependency', jsonb_build_object(
        'kind','contacts_for_accounts',
        'depends_on', jsonb_build_array('property_account_id','property_managing_account_id')
      )),
    jsonb_build_object('name','property_heating_fuel_provider','label','Heating Fuel Provider'),
    jsonb_build_object('name','property_electric_fuel_provider','label','Electric Fuel Provider'),
    jsonb_build_object('name','property_heating_system_type','label','Heating System Type'),
    jsonb_build_object('name','property_heating_fuel_type','label','Heating Fuel Type'),
    jsonb_build_object('name','property_water_heating_fuel_provider','label','Water Heating Fuel Provider'),
    jsonb_build_object('name','property_water_heating_fuel_type','label','Water Heating Fuel Type'),
    jsonb_build_object('name','property_water_heating_system_type','label','Water Heating System Type'),
    jsonb_build_object('name','property_cooling_system_type','label','Cooling System Type'),
    jsonb_build_object('name','property_aka_name','label','AKA Name'),
    jsonb_build_object('name','property_year_built','label','Year Built'),
    jsonb_build_object('name','property_customer_class','label','Customer Class'),
    jsonb_build_object('name','property_average_building_year_built','label','Average Building Year Built'),
    jsonb_build_object('name','property_website','label','Website'),
    jsonb_build_object('name','property_subsidize_rent_type_notes','label','Subsidize Rent Type Notes'),
    jsonb_build_object('name','property_subsidize_rent_type_reference','label','Subsidize Rent Type Reference'),
    jsonb_build_object('name','property_market_type','label','Market Type'),
    jsonb_build_object('name','property_subsidy_type','type','picklist','label','Subsidized Type'),
    jsonb_build_object('name','property_assessor_link','label','Assessor Link'),
    jsonb_build_object('name','property_inquiry_pp','label','Inquiry PP'),
    jsonb_build_object('name','property_enable_self_scheduling','label','Enable Self Scheduling'),
    jsonb_build_object('name','property_opportunity_sum','label','Opportunity Sum')
  )
), updated_at = now()
WHERE id = 'd8e4e4af-7b50-4db9-88f1-8926306871f7';

-- Layout: Non-Residential (widget 5bddb7e3) — does NOT have account fields
-- in this widget. The depends_on list still references property_account_id
-- because the host record (properties row) carries those values regardless
-- of whether they appear on this layout. Filtering against the stored
-- record fields is the correct behavior.
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','property_street','label','Property Address','required',true),
    jsonb_build_object('name','property_city','label','Property City','required',true),
    jsonb_build_object('name','property_state','label','Property State','required',true),
    jsonb_build_object('name','property_zip','label','Property Zip'),
    jsonb_build_object('name','property_county','label','Property County'),
    jsonb_build_object('name','property_status','type','picklist','label','Status'),
    jsonb_build_object('name','property_status_description','label','Status Description'),
    jsonb_build_object('name','property_assessor_link','label','Assessor Link'),
    jsonb_build_object('name','property_parcel_number','label','Parcel Number'),
    jsonb_build_object('name','property_primary_contact_id','type','lookup','label','Site Contact','lookup_field','contact_name','lookup_table','contacts',
      'lookup_dependency', jsonb_build_object(
        'kind','contacts_for_accounts',
        'depends_on', jsonb_build_array('property_account_id','property_managing_account_id')
      ))
  )
), updated_at = now()
WHERE id = '5bddb7e3-5a66-490a-85ee-8ad2954a2a39';

-- Layout: Single Family (widget 4c7126b0) — only has property_account_id
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','property_name','label','Name','required',true),
    jsonb_build_object('name','property_account_id','type','lookup','label','Property Owner','required',true,'lookup_field','account_name','lookup_table','accounts'),
    jsonb_build_object('name','property_primary_contact_id','type','lookup','label','Site Contact','lookup_field','contact_name','lookup_table','contacts',
      'lookup_dependency', jsonb_build_object(
        'kind','contacts_for_accounts',
        'depends_on', jsonb_build_array('property_account_id','property_managing_account_id')
      ))
  )
), updated_at = now()
WHERE id = '4c7126b0-46b5-4178-b6ce-9ab9d6edaa3f';

-- ---------------------------------------------------------------------
-- Standing self-test from the stabilization sweep — every live
-- widget_config field reference must resolve in information_schema.
-- ---------------------------------------------------------------------
DO $$
DECLARE bad RECORD; bad_count integer := 0;
BEGIN
  FOR bad IN
    WITH fg AS (
      SELECT w.id AS widget_id, pl.page_layout_name, pl.page_layout_object AS host_table, w.widget_config
        FROM page_layout_widgets w JOIN page_layouts pl ON pl.id=w.page_layout_id
       WHERE NOT w.is_deleted AND NOT pl.is_deleted AND w.widget_type='field_group'
    ),
    ff AS (
      SELECT widget_id, page_layout_name, host_table, f->>'name' AS field_name,
             f->>'lookup_table' AS lookup_table, f->>'lookup_field' AS lookup_field
        FROM fg, jsonb_array_elements(fg.widget_config->'fields') AS f
    )
    SELECT ff.widget_id, ff.page_layout_name, ff.host_table, ff.field_name AS broken
      FROM ff
     WHERE ff.field_name IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=ff.host_table AND column_name=ff.field_name
       )
  LOOP
    bad_count := bad_count + 1;
    RAISE WARNING 'field_group missing host column: layout=% host=% field=% widget=%',
      bad.page_layout_name, bad.host_table, bad.broken, bad.widget_id;
  END LOOP;

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'self-test FAILED: % broken widget_config refs remain', bad_count;
  END IF;
END $$;
