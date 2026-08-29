-- A property's Systems Information rolls up from its buildings.
--
-- Nicholas: "The property page needs to read what the buildings are... they
-- inherit up. Does that make sense? Just like units do."
--
-- What it did instead: every field in the property's Systems Information section
-- was a `child_lookup` related field that walked property -> its most recently
-- created OPPORTUNITY -> that opportunity's building_id -> the building. So the
-- property showed ONE building, picked by whichever opportunity happened to be
-- newest, and a property with two buildings and no opportunity showed nothing at
-- all. That is not what the buildings are.
--
-- The mechanism this should have used already exists and is already wired:
-- buildings roll up to the property through recompute_property_rollups(), which
-- every building INSERT/UPDATE/DELETE already calls (buildings_rollup_iud). It
-- carried only the building and unit COUNTS. It now carries the systems and
-- utility facts too, exactly as In-Unit Information rolls up from units
-- (HA-00149).
--
-- How each kind rolls up:
--   * a type / fuel / utility / provider  -> the buildings' one answer; 'Mixed'
--     when they disagree; blank when none of them has answered. (A picklist has
--     no meaningful sum or average, and Salesforce roll-up summaries do not
--     support picklists either -- the honest analogue is the agreed value, and
--     'Mixed' is already a value in the building heating-system list.)
--   * an equipment capacity              -> SUM across the buildings
--   * an equipment year of install       -> AVG across the buildings, rounded
--   The layout labels already read "Capacity BTUs" and "Avg Year of Install",
--   so these are the totals the page has been promising all along.
--
-- The one deliberate asymmetry, and why: a property with NO buildings is left
-- completely untouched. 7,545 properties carry a gas or electric utility from
-- the HUD import and have no building on file; a roll-up over an empty set says
-- nothing, and blanking them would destroy real (if approximate) data on
-- thousands of records. Where a property DOES have buildings, the buildings are
-- the answer -- including when they are silent, because "we have buildings on
-- file and nobody recorded the utility" is the truth, and better on a property
-- we are actively working than a regional guess.

-- ---------------------------------------------------------------------------
-- 1. The roll-up itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_property_rollups(p_property_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_account_id uuid;
  v_buildings  int;
  v_units      int;
  v_dwelling   uuid;
  v_heat_type  text; v_heat_fuel text; v_cool_type text;
  v_wh_type    text; v_wh_fuel   text;
  v_gas        text; v_elec      text;
  v_heat_prov  text; v_elec_prov text; v_wh_prov text;
  v_heat_cap   numeric; v_cool_cap numeric; v_wh_cap numeric;
  v_heat_yr    numeric; v_cool_yr  numeric;
begin
  if p_property_id is null then return; end if;

  select id into v_dwelling from picklist_values
   where picklist_object='units' and picklist_field='record_type'
     and picklist_value='DWELLING-UNIT' limit 1;

  select count(*)::int into v_buildings from buildings b
   where b.property_id = p_property_id and not b.building_is_deleted;

  select count(*)::int into v_units from units u
    join buildings b on b.id = u.building_id and not b.building_is_deleted
   where b.property_id = p_property_id and not u.unit_is_deleted
     and u.unit_record_type = v_dwelling;

  update properties p
     set property_number_of_buildings   = v_buildings::numeric,
         property_total_buildings       = v_buildings,
         property_total_number_of_units = v_units::numeric,
         property_total_units           = v_units
   where p.id = p_property_id
   returning p.property_account_id into v_account_id;

  -- Systems and utilities, from the property's own buildings. A picklist column
  -- resolves to its LABEL, because the property columns are text and a stored
  -- uuid prints as a uuid on the page and in every report.
  if v_buildings > 0 then
    select
      case count(distinct pv_hs.picklist_label) when 0 then null when 1 then max(pv_hs.picklist_label) else 'Mixed' end,
      case count(distinct pv_hf.picklist_label) when 0 then null when 1 then max(pv_hf.picklist_label) else 'Mixed' end,
      case count(distinct pv_ct.picklist_label) when 0 then null when 1 then max(pv_ct.picklist_label) else 'Mixed' end,
      case count(distinct pv_wt.picklist_label) when 0 then null when 1 then max(pv_wt.picklist_label) else 'Mixed' end,
      case count(distinct pv_wf.picklist_label) when 0 then null when 1 then max(pv_wf.picklist_label) else 'Mixed' end,
      case count(distinct pv_gu.picklist_label) when 0 then null when 1 then max(pv_gu.picklist_label) else 'Mixed' end,
      case count(distinct pv_eu.picklist_label) when 0 then null when 1 then max(pv_eu.picklist_label) else 'Mixed' end,
      case count(distinct nullif(btrim(b.building_heating_fuel_provider), ''))
        when 0 then null when 1 then max(nullif(btrim(b.building_heating_fuel_provider), '')) else 'Mixed' end,
      case count(distinct nullif(btrim(b.building_electric_fuel_provider), ''))
        when 0 then null when 1 then max(nullif(btrim(b.building_electric_fuel_provider), '')) else 'Mixed' end,
      case count(distinct nullif(btrim(b.building_water_heating_fuel_provider), ''))
        when 0 then null when 1 then max(nullif(btrim(b.building_water_heating_fuel_provider), '')) else 'Mixed' end,
      sum(b.building_heating_equipment_capacity),
      sum(b.building_cooling_equipment_capacity),
      sum(b.building_water_heating_equipment_capacity),
      round(avg(b.building_heating_equipment_year_of_install)),
      round(avg(b.building_cooling_equipment_year_of_install))
    into
      v_heat_type, v_heat_fuel, v_cool_type, v_wh_type, v_wh_fuel,
      v_gas, v_elec, v_heat_prov, v_elec_prov, v_wh_prov,
      v_heat_cap, v_cool_cap, v_wh_cap, v_heat_yr, v_cool_yr
    from buildings b
    left join picklist_values pv_hs on pv_hs.id = b.building_heating_system_type
    left join picklist_values pv_hf on pv_hf.id = b.building_heating_fuel_type
    left join picklist_values pv_ct on pv_ct.id = b.building_cooling_type
    left join picklist_values pv_wt on pv_wt.id = b.building_water_heater_type
    left join picklist_values pv_wf on pv_wf.id = b.building_water_heating_fuel_type
    left join picklist_values pv_gu on pv_gu.id = b.building_gas_utility
    left join picklist_values pv_eu on pv_eu.id = b.building_electric_utility
    where b.property_id = p_property_id and not b.building_is_deleted;

    update properties p
       set property_heating_system_type       = v_heat_type,
           property_heating_fuel_type         = v_heat_fuel,
           property_cooling_system_type       = v_cool_type,
           property_water_heating_system_type = v_wh_type,
           property_water_heating_fuel_type   = v_wh_fuel,
           property_gas_utility               = v_gas,
           property_electric_utility          = v_elec,
           property_heating_fuel_provider     = v_heat_prov,
           property_electric_fuel_provider    = v_elec_prov,
           property_water_heating_fuel_provider = v_wh_prov,
           property_heating_equipment_capacity_btus       = v_heat_cap,
           property_cooling_equipment_capacity_btus       = v_cool_cap,
           property_water_heating_equipment_capacity_btus = v_wh_cap,
           property_heating_equipment_average_year_of_install = v_heat_yr,
           property_cooling_equipment_ave_year_of_install     = v_cool_yr
     where p.id = p_property_id
       and (p.property_heating_system_type       is distinct from v_heat_type
         or p.property_heating_fuel_type         is distinct from v_heat_fuel
         or p.property_cooling_system_type       is distinct from v_cool_type
         or p.property_water_heating_system_type is distinct from v_wh_type
         or p.property_water_heating_fuel_type   is distinct from v_wh_fuel
         or p.property_gas_utility               is distinct from v_gas
         or p.property_electric_utility          is distinct from v_elec
         or p.property_heating_fuel_provider     is distinct from v_heat_prov
         or p.property_electric_fuel_provider    is distinct from v_elec_prov
         or p.property_water_heating_fuel_provider is distinct from v_wh_prov
         or p.property_heating_equipment_capacity_btus is distinct from v_heat_cap
         or p.property_cooling_equipment_capacity_btus is distinct from v_cool_cap
         or p.property_water_heating_equipment_capacity_btus is distinct from v_wh_cap
         or p.property_heating_equipment_average_year_of_install is distinct from v_heat_yr
         or p.property_cooling_equipment_ave_year_of_install     is distinct from v_cool_yr);
  end if;

  update opportunities o
     set opportunity_total_number_of_units = v_units,
         opportunity_total_units           = v_units
   where o.property_id = p_property_id and not o.opportunity_is_deleted
     and (o.opportunity_total_number_of_units is distinct from v_units
          or o.opportunity_total_units is distinct from v_units);

  perform recompute_account_rollups(v_account_id);
end;
$function$;

REVOKE ALL ON FUNCTION public.recompute_property_rollups(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_property_rollups(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_property_rollups(uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. Backfill every property that has buildings.
--    Under `replica` so the audit logger does not record a migration as a
--    person's edit (the 2026-08-22 backfill rule).
-- ---------------------------------------------------------------------------
SET session_replication_role = replica;

DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT b.property_id AS id
    FROM buildings b
    WHERE NOT b.building_is_deleted AND b.property_id IS NOT NULL
  LOOP
    PERFORM recompute_property_rollups(r.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'recomputed % properties', v_n;
END $$;

SET session_replication_role = DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. The layouts read the property's own rolled-up columns, as ROLLUP fields.
--
--    `type: 'rollup'` is the platform's existing computed-field type: the
--    renderer shows it read-only with a ROLLUP chip and "rolled up from related
--    records", and fieldMetadataService already refuses to make one editable.
--    That matters here -- these columns are written by the trigger, so an
--    editable box would offer a change the next building save silently reverts.
-- ---------------------------------------------------------------------------
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{fields}',
      (SELECT jsonb_agg(
                CASE COALESCE(f->'related'->>'column', f->>'name')
                  WHEN 'building_heating_system_type'              THEN (f - 'related') || jsonb_build_object('name','property_heating_system_type','type','rollup')
                  WHEN 'property_heating_system_type'              THEN f || jsonb_build_object('type','rollup')
                  WHEN 'building_heating_fuel_type'                THEN (f - 'related') || jsonb_build_object('name','property_heating_fuel_type','type','rollup')
                  WHEN 'property_heating_fuel_type'                THEN f || jsonb_build_object('type','rollup')
                  WHEN 'building_cooling_type'                     THEN (f - 'related') || jsonb_build_object('name','property_cooling_system_type','type','rollup')
                  WHEN 'property_cooling_system_type'              THEN f || jsonb_build_object('type','rollup')
                  WHEN 'building_water_heater_type'                THEN (f - 'related') || jsonb_build_object('name','property_water_heating_system_type','type','rollup')
                  WHEN 'property_water_heating_system_type'        THEN f || jsonb_build_object('type','rollup')
                  WHEN 'building_water_heating_fuel_type'          THEN (f - 'related') || jsonb_build_object('name','property_water_heating_fuel_type','type','rollup')
                  WHEN 'property_water_heating_fuel_type'          THEN f || jsonb_build_object('type','rollup')
                  WHEN 'building_heating_fuel_provider'            THEN (f - 'related') || jsonb_build_object('name','property_heating_fuel_provider','type','rollup')
                  WHEN 'property_heating_fuel_provider'            THEN f || jsonb_build_object('type','rollup')
                  WHEN 'building_electric_fuel_provider'           THEN (f - 'related') || jsonb_build_object('name','property_electric_fuel_provider','type','rollup')
                  WHEN 'property_electric_fuel_provider'           THEN f || jsonb_build_object('type','rollup')
                  WHEN 'building_water_heating_fuel_provider'      THEN (f - 'related') || jsonb_build_object('name','property_water_heating_fuel_provider','type','rollup')
                  WHEN 'property_water_heating_fuel_provider'      THEN f || jsonb_build_object('type','rollup')
                  WHEN 'building_heating_equipment_capacity'       THEN (f - 'related') || jsonb_build_object('name','property_heating_equipment_capacity_btus','type','rollup')
                  WHEN 'building_cooling_equipment_capacity'       THEN (f - 'related') || jsonb_build_object('name','property_cooling_equipment_capacity_btus','type','rollup')
                  WHEN 'building_water_heating_equipment_capacity' THEN (f - 'related') || jsonb_build_object('name','property_water_heating_equipment_capacity_btus','type','rollup')
                  WHEN 'building_heating_equipment_year_of_install' THEN (f - 'related') || jsonb_build_object('name','property_heating_equipment_average_year_of_install','type','rollup')
                  WHEN 'building_cooling_equipment_year_of_install' THEN (f - 'related') || jsonb_build_object('name','property_cooling_equipment_ave_year_of_install','type','rollup')
                  ELSE f
                END
                ORDER BY ord)
       FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)))
FROM page_layouts l
WHERE l.id = w.page_layout_id
  AND l.page_layout_object = 'properties'
  AND COALESCE(l.is_deleted, false) = false
  AND COALESCE(w.is_deleted, false) = false
  AND w.widget_type = 'field_group'
  AND jsonb_typeof(w.widget_config->'fields') = 'array'
  AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') e
        WHERE COALESCE(e->'related'->>'column', e->>'name') IN (
          'building_heating_system_type','property_heating_system_type',
          'building_heating_fuel_type','property_heating_fuel_type',
          'building_cooling_type','property_cooling_system_type',
          'building_water_heater_type','property_water_heating_system_type',
          'building_water_heating_fuel_type','property_water_heating_fuel_type',
          'building_heating_fuel_provider','property_heating_fuel_provider',
          'building_electric_fuel_provider','property_electric_fuel_provider',
          'building_water_heating_fuel_provider','property_water_heating_fuel_provider',
          'building_heating_equipment_capacity','building_cooling_equipment_capacity',
          'building_water_heating_equipment_capacity',
          'building_heating_equipment_year_of_install','building_cooling_equipment_year_of_install'));

-- Gas Utility and Electric Utility now roll up too, and were on no property
-- layout at all -- so the property could never show what its buildings say
-- about the two fields this whole change started from.
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{fields}',
      (w.widget_config->'fields')
        || jsonb_build_array(
             jsonb_build_object('name','property_gas_utility','type','rollup','label','Gas Utility','column',1),
             jsonb_build_object('name','property_electric_utility','type','rollup','label','Electric Utility','column',2)))
FROM page_layouts l, page_layout_sections s
WHERE l.id = w.page_layout_id
  AND s.id = w.section_id
  AND l.page_layout_object = 'properties'
  AND COALESCE(l.is_deleted, false) = false
  AND COALESCE(s.is_deleted, false) = false
  AND COALESCE(w.is_deleted, false) = false
  AND w.widget_type = 'field_group'
  AND s.section_label = 'Systems Information'
  AND jsonb_typeof(w.widget_config->'fields') = 'array'
  AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') e
        WHERE e->>'name' IN ('property_gas_utility','property_electric_utility'));

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  -- No property layout may still walk to a building through an opportunity for
  -- a systems fact. That path is what this change exists to remove.
  SELECT count(*) INTO v_n
  FROM page_layouts l
  JOIN page_layout_sections s ON s.page_layout_id = l.id AND COALESCE(s.is_deleted,false) = false
  JOIN page_layout_widgets w ON w.section_id = s.id AND COALESCE(w.is_deleted,false) = false
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE COALESCE(l.is_deleted,false) = false
    AND l.page_layout_object = 'properties'
    AND f->>'name' LIKE 'opportunity_building.%';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% property layout field(s) still read a building through an opportunity', v_n;
  END IF;

  -- Every rolled-up field must be declared read-only, or the page offers an
  -- edit the next building save reverts.
  SELECT count(*) INTO v_n
  FROM page_layouts l
  JOIN page_layout_sections s ON s.page_layout_id = l.id AND COALESCE(s.is_deleted,false) = false
  JOIN page_layout_widgets w ON w.section_id = s.id AND COALESCE(w.is_deleted,false) = false
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE COALESCE(l.is_deleted,false) = false
    AND l.page_layout_object = 'properties'
    AND f->>'name' IN (
      'property_heating_system_type','property_heating_fuel_type','property_cooling_system_type',
      'property_water_heating_system_type','property_water_heating_fuel_type',
      'property_gas_utility','property_electric_utility',
      'property_heating_fuel_provider','property_electric_fuel_provider','property_water_heating_fuel_provider',
      'property_heating_equipment_capacity_btus','property_cooling_equipment_capacity_btus',
      'property_water_heating_equipment_capacity_btus',
      'property_heating_equipment_average_year_of_install','property_cooling_equipment_ave_year_of_install')
    AND COALESCE(f->>'type','') <> 'rollup';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% property layout field(s) bind a rolled-up column without declaring it a rollup', v_n;
  END IF;

  -- A property with no buildings must not have been touched.
  SELECT count(*) INTO v_n
  FROM properties p
  WHERE COALESCE(p.property_is_deleted,false) = false
    AND p.property_gas_utility IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.property_id = p.id AND NOT b.building_is_deleted);
  IF v_n < 7000 THEN
    RAISE EXCEPTION 'the HUD utility values on building-less properties were not preserved (% left)', v_n;
  END IF;
END $$;
