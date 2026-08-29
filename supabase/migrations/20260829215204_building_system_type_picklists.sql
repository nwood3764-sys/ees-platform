-- Building Systems: Cooling System Type, Water Heating System Type and Water
-- Heating Fuel Type become real picklists on the building page.
--
-- The defect, stated plainly: the buildings table carries TWO columns for each
-- of these facts. The picklist column was built, seeded and is already bound on
-- the PROPERTY page (opportunity_building.building_cooling_type /
-- .building_water_heater_type render as picklists there) and read by the
-- Outreach list. The four BUILDING layouts were left on the legacy import twin,
-- which is plain `text` -- so the renderer correctly gave a free-text box while
-- Heating System Type beside it (a uuid FK to picklist_values) was a dropdown.
--
--   layout bound (text)                    real picklist column
--   building_cooling_system_type       ->  building_cooling_type        (8 values)
--   building_water_heating_system_type ->  building_water_heater_type   (5 values)
--   building_water_heating_fuel_type   ->  (the value set existed under the name
--                                           building_water_heater_fuel_type with
--                                           NO column at all -- 3 values)
--
-- This repoints the layouts onto the columns that are already the platform's
-- answer (the same fix as PR #472 on the assessment layouts), converts the one
-- remaining text column in place rather than minting a third twin, carries the
-- two free-text values that exist, and retires the dead columns so the next
-- session cannot bind the wrong one again.


-- ---------------------------------------------------------------------------
-- 1. Carry the live free-text values onto the picklist columns.
--    Two values on one building (BLD-00075) are the entire live population.
--    Written under `replica` so the audit logger does not record a migration as
--    a person's edit and the audit-stamping trigger does not overwrite them
--    (the 2026-08-22 backfill rule).
-- ---------------------------------------------------------------------------
SET session_replication_role = replica;

-- "Through-the-wall air conditioner" is exactly TTW - Through the Wall.
UPDATE buildings b
SET building_cooling_type = pv.id
FROM picklist_values pv
WHERE pv.picklist_object = 'buildings'
  AND pv.picklist_field = 'building_cooling_type'
  AND pv.picklist_value = 'TTW - Through the Wall'
  AND b.building_cooling_system_type = 'Through-the-wall air conditioner'
  AND b.building_cooling_type IS NULL;

-- "Electric water heater. Central." states the FUEL but not which of the five
-- water-heater types it is. Guessing the type would put a fact in the record
-- that nobody observed, so the sentence is preserved in the notes column and
-- the type is left for a human to pick.
UPDATE buildings
SET building_water_heating_system_notes =
      COALESCE(NULLIF(building_water_heating_system_notes, '') || ' ', '')
      || btrim(building_water_heating_system_type)
WHERE building_water_heating_system_type IS NOT NULL
  AND btrim(building_water_heating_system_type) <> '';

SET session_replication_role = DEFAULT;

-- Nothing may be dropped that was not carried.
DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left
  FROM buildings
  WHERE building_cooling_system_type IS NOT NULL
    AND building_cooling_type IS NULL;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'building_cooling_system_type still holds % value(s) that did not map onto building_cooling_type', v_left;
  END IF;

  SELECT count(*) INTO v_left
  FROM buildings
  WHERE building_water_heating_system_type IS NOT NULL
    AND building_water_heating_system_notes IS NULL;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'building_water_heating_system_type still holds % value(s) that were not carried into the notes', v_left;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Water Heating Fuel Type: the value set exists, the column it names does
--    not. Point the value set at the column that IS referenced (by the building
--    layouts and by the property Systems Information related fields) rather
--    than adding a third twin column.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_moved int; v_rows int;
BEGIN
  SELECT count(*) INTO v_rows FROM buildings WHERE building_water_heating_fuel_type IS NOT NULL;
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'building_water_heating_fuel_type holds % text value(s); the in-place type change would discard them', v_rows;
  END IF;

  UPDATE picklist_values
  SET picklist_field = 'building_water_heating_fuel_type'
  WHERE picklist_object = 'buildings'
    AND picklist_field = 'building_water_heater_fuel_type';
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved = 0 THEN
    RAISE EXCEPTION 'expected the building_water_heater_fuel_type value set to exist';
  END IF;
END $$;

ALTER TABLE buildings
  ALTER COLUMN building_water_heating_fuel_type TYPE uuid USING NULL::uuid;

ALTER TABLE buildings
  ADD CONSTRAINT buildings_building_water_heating_fuel_type_fkey
  FOREIGN KEY (building_water_heating_fuel_type) REFERENCES picklist_values(id);

-- ---------------------------------------------------------------------------
-- 3. Repoint the building layouts onto the picklist columns.
-- ---------------------------------------------------------------------------
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{fields}',
      (SELECT jsonb_agg(
                CASE f->>'name'
                  WHEN 'building_cooling_system_type'
                    THEN f || jsonb_build_object('name','building_cooling_type','type','picklist','label','Cooling System Type')
                  WHEN 'building_water_heating_system_type'
                    THEN f || jsonb_build_object('name','building_water_heater_type','type','picklist','label','Water Heating System Type')
                  WHEN 'building_water_heating_fuel_type'
                    THEN f || jsonb_build_object('type','picklist','label','Water Heating Fuel Type')
                  ELSE f
                END
                ORDER BY ord)
       FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)))
FROM page_layouts l
WHERE l.id = w.page_layout_id
  AND l.page_layout_object = 'buildings'
  AND COALESCE(l.is_deleted, false) = false
  AND COALESCE(w.is_deleted, false) = false
  AND w.widget_type = 'field_group'
  AND jsonb_typeof(w.widget_config->'fields') = 'array'
  AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') e
        WHERE e->>'name' IN ('building_cooling_system_type',
                             'building_water_heating_system_type',
                             'building_water_heating_fuel_type'));

-- The property Systems Information sections read the building's fuel type
-- through a related field, which froze the column's type as `text` at
-- placement (the 2026-07-26 overlayRelatedFieldDisplayTypes case).
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{fields}',
      (SELECT jsonb_agg(
                CASE
                  WHEN f->>'name' LIKE '%.building_water_heating_fuel_type'
                    THEN jsonb_set(f, '{related,column_type}', '"picklist"'::jsonb)
                  ELSE f
                END
                ORDER BY ord)
       FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)))
WHERE COALESCE(w.is_deleted, false) = false
  AND w.widget_type = 'field_group'
  AND jsonb_typeof(w.widget_config->'fields') = 'array'
  AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') e
        WHERE e->>'name' LIKE '%.building_water_heating_fuel_type');

-- ---------------------------------------------------------------------------
-- 4. Retire the dead columns. No view, function, report, list view or field
--    metadata row references either (swept before writing this). Leaving them
--    in place is what let a layout bind the wrong one for months.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bound int;
BEGIN
  SELECT count(*) INTO v_bound
  FROM page_layouts l
  JOIN page_layout_sections s ON s.page_layout_id = l.id AND COALESCE(s.is_deleted,false) = false
  JOIN page_layout_widgets w ON w.section_id = s.id AND COALESCE(w.is_deleted,false) = false
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE COALESCE(l.is_deleted,false) = false
    AND (f->>'name' = 'building_cooling_system_type'
      OR f->>'name' = 'building_water_heating_system_type'
      OR f->>'name' LIKE '%.building_cooling_system_type'
      OR f->>'name' LIKE '%.building_water_heating_system_type');
  IF v_bound > 0 THEN
    RAISE EXCEPTION '% live layout field(s) still bind the retired building columns', v_bound;
  END IF;
END $$;

ALTER TABLE buildings DROP COLUMN building_cooling_system_type;
ALTER TABLE buildings DROP COLUMN building_water_heating_system_type;

-- ---------------------------------------------------------------------------
-- 5. Assert the outcome rather than trusting the statements above.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'buildings'
    AND column_name IN ('building_cooling_type','building_water_heater_type','building_water_heating_fuel_type')
    AND data_type = 'uuid';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'expected 3 uuid picklist columns on buildings, found %', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM page_layouts l
  JOIN page_layout_sections s ON s.page_layout_id = l.id AND COALESCE(s.is_deleted,false) = false
  JOIN page_layout_widgets w ON w.section_id = s.id AND COALESCE(w.is_deleted,false) = false
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE COALESCE(l.is_deleted,false) = false
    AND l.page_layout_object = 'buildings'
    AND f->>'name' IN ('building_cooling_type','building_water_heater_type','building_water_heating_fuel_type')
    AND COALESCE(f->>'type','') <> 'picklist';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% building layout field(s) still declare a non-picklist type', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field = 'building_water_heating_fuel_type'
    AND picklist_is_active;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'building_water_heating_fuel_type has no active values';
  END IF;
END $$;

