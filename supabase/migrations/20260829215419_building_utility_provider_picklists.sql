-- Gas Utility and Electric Utility become picklists on the building.
--
-- Unlike the system-type fields, these were never built. Both columns are plain
-- `text`, the layout entries carry no `type` at all, and no utility value set
-- existed anywhere in the platform (every picklist_field on every object was
-- swept). The live values were typed by hand -- "WE Energies", "Alliant Energy",
-- "N/A" -- which is how the same company ends up spelled three ways and how a
-- utility can never be reported on.
--
-- The value sets are STATE-SCOPED (picklist_state), because which utilities
-- exist is a fact about where the building is: a Rocky Mount building has no
-- business being offered Madison Gas and Electric. picklist_value carries the
-- state prefix because (picklist_object, picklist_field, picklist_value) is
-- unique and a utility can serve more than one state; picklist_label is the
-- plain company name the user reads. Values with NO state (Other, and "no
-- natural gas service") are offered everywhere.
--
-- Seeded with the regulated utilities of the five states EES operates in.
-- This is a starting set, not a closed one -- values are added, renamed and
-- retired in LEAP Admin without a deploy, which is the point of a picklist.


-- ---------------------------------------------------------------------------
-- 1. Seed the two value sets.
-- ---------------------------------------------------------------------------
INSERT INTO picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_state,
   picklist_is_active, picklist_sort_order)
SELECT 'buildings', v.field, v.value, v.label, v.state, true, v.sort
FROM (VALUES
  -- Electric -- Wisconsin
  ('building_electric_utility','WI-WE-ENERGIES','We Energies','WI',10),
  ('building_electric_utility','WI-MADISON-GAS-AND-ELECTRIC','Madison Gas and Electric','WI',20),
  ('building_electric_utility','WI-ALLIANT-ENERGY','Alliant Energy','WI',30),
  ('building_electric_utility','WI-WISCONSIN-PUBLIC-SERVICE','Wisconsin Public Service','WI',40),
  ('building_electric_utility','WI-XCEL-ENERGY','Xcel Energy','WI',50),
  ('building_electric_utility','WI-SUPERIOR-WATER-LIGHT-AND-POWER','Superior Water, Light and Power','WI',60),
  ('building_electric_utility','WI-MUNICIPAL-ELECTRIC-UTILITY','Municipal Electric Utility','WI',70),
  ('building_electric_utility','WI-ELECTRIC-COOPERATIVE','Electric Cooperative','WI',80),
  -- Electric -- North Carolina
  ('building_electric_utility','NC-DUKE-ENERGY-CAROLINAS','Duke Energy Carolinas','NC',10),
  ('building_electric_utility','NC-DUKE-ENERGY-PROGRESS','Duke Energy Progress','NC',20),
  ('building_electric_utility','NC-DOMINION-ENERGY-NORTH-CAROLINA','Dominion Energy North Carolina','NC',30),
  ('building_electric_utility','NC-MUNICIPAL-ELECTRIC-UTILITY','Municipal Electric Utility','NC',40),
  ('building_electric_utility','NC-ELECTRIC-MEMBERSHIP-COOPERATIVE','Electric Membership Cooperative','NC',50),
  -- Electric -- Colorado
  ('building_electric_utility','CO-XCEL-ENERGY','Xcel Energy','CO',10),
  ('building_electric_utility','CO-BLACK-HILLS-ENERGY','Black Hills Energy','CO',20),
  ('building_electric_utility','CO-COLORADO-SPRINGS-UTILITIES','Colorado Springs Utilities','CO',30),
  ('building_electric_utility','CO-MUNICIPAL-ELECTRIC-UTILITY','Municipal Electric Utility','CO',40),
  ('building_electric_utility','CO-ELECTRIC-COOPERATIVE','Electric Cooperative','CO',50),
  -- Electric -- Michigan
  ('building_electric_utility','MI-DTE-ENERGY','DTE Energy','MI',10),
  ('building_electric_utility','MI-CONSUMERS-ENERGY','Consumers Energy','MI',20),
  ('building_electric_utility','MI-INDIANA-MICHIGAN-POWER','Indiana Michigan Power','MI',30),
  ('building_electric_utility','MI-UPPER-PENINSULA-POWER-COMPANY','Upper Peninsula Power Company','MI',40),
  ('building_electric_utility','MI-MUNICIPAL-ELECTRIC-UTILITY','Municipal Electric Utility','MI',50),
  ('building_electric_utility','MI-ELECTRIC-COOPERATIVE','Electric Cooperative','MI',60),
  -- Electric -- Indiana
  ('building_electric_utility','IN-AES-INDIANA','AES Indiana','IN',10),
  ('building_electric_utility','IN-DUKE-ENERGY-INDIANA','Duke Energy Indiana','IN',20),
  ('building_electric_utility','IN-INDIANA-MICHIGAN-POWER','Indiana Michigan Power','IN',30),
  ('building_electric_utility','IN-CENTERPOINT-ENERGY-INDIANA-SOUTH','CenterPoint Energy Indiana South','IN',40),
  ('building_electric_utility','IN-NIPSCO','Northern Indiana Public Service Company (NIPSCO)','IN',50),
  ('building_electric_utility','IN-MUNICIPAL-ELECTRIC-UTILITY','Municipal Electric Utility','IN',60),
  ('building_electric_utility','IN-ELECTRIC-COOPERATIVE','Electric Cooperative','IN',70),
  -- Electric -- offered everywhere
  ('building_electric_utility','OTHER','Other',NULL,900),

  -- Gas -- Wisconsin
  ('building_gas_utility','WI-WE-ENERGIES','We Energies','WI',10),
  ('building_gas_utility','WI-MADISON-GAS-AND-ELECTRIC','Madison Gas and Electric','WI',20),
  ('building_gas_utility','WI-WISCONSIN-PUBLIC-SERVICE','Wisconsin Public Service','WI',30),
  ('building_gas_utility','WI-ALLIANT-ENERGY','Alliant Energy','WI',40),
  ('building_gas_utility','WI-XCEL-ENERGY','Xcel Energy','WI',50),
  ('building_gas_utility','WI-SUPERIOR-WATER-LIGHT-AND-POWER','Superior Water, Light and Power','WI',60),
  ('building_gas_utility','WI-MICHIGAN-GAS-UTILITIES','Michigan Gas Utilities','WI',70),
  ('building_gas_utility','WI-MUNICIPAL-GAS-UTILITY','Municipal Gas Utility','WI',80),
  -- Gas -- North Carolina
  ('building_gas_utility','NC-PIEDMONT-NATURAL-GAS','Piedmont Natural Gas','NC',10),
  ('building_gas_utility','NC-DOMINION-ENERGY-NORTH-CAROLINA','Dominion Energy North Carolina','NC',20),
  ('building_gas_utility','NC-FRONTIER-NATURAL-GAS','Frontier Natural Gas','NC',30),
  ('building_gas_utility','NC-MUNICIPAL-GAS-UTILITY','Municipal Gas Utility','NC',40),
  -- Gas -- Colorado
  ('building_gas_utility','CO-XCEL-ENERGY','Xcel Energy','CO',10),
  ('building_gas_utility','CO-BLACK-HILLS-ENERGY','Black Hills Energy','CO',20),
  ('building_gas_utility','CO-ATMOS-ENERGY','Atmos Energy','CO',30),
  ('building_gas_utility','CO-COLORADO-NATURAL-GAS','Colorado Natural Gas','CO',40),
  ('building_gas_utility','CO-COLORADO-SPRINGS-UTILITIES','Colorado Springs Utilities','CO',50),
  ('building_gas_utility','CO-MUNICIPAL-GAS-UTILITY','Municipal Gas Utility','CO',60),
  -- Gas -- Michigan
  ('building_gas_utility','MI-DTE-GAS','DTE Gas','MI',10),
  ('building_gas_utility','MI-CONSUMERS-ENERGY','Consumers Energy','MI',20),
  ('building_gas_utility','MI-SEMCO-ENERGY','SEMCO Energy','MI',30),
  ('building_gas_utility','MI-MICHIGAN-GAS-UTILITIES','Michigan Gas Utilities','MI',40),
  ('building_gas_utility','MI-MUNICIPAL-GAS-UTILITY','Municipal Gas Utility','MI',50),
  -- Gas -- Indiana
  ('building_gas_utility','IN-NIPSCO','Northern Indiana Public Service Company (NIPSCO)','IN',10),
  ('building_gas_utility','IN-CENTERPOINT-ENERGY-INDIANA','CenterPoint Energy Indiana','IN',20),
  ('building_gas_utility','IN-CITIZENS-ENERGY-GROUP','Citizens Energy Group','IN',30),
  ('building_gas_utility','IN-OHIO-VALLEY-GAS','Ohio Valley Gas','IN',40),
  ('building_gas_utility','IN-MUNICIPAL-GAS-UTILITY','Municipal Gas Utility','IN',50),
  -- Gas -- offered everywhere. A building with no gas service is a fact worth
  -- recording; it is not the same as nobody having answered.
  ('building_gas_utility','NO-NATURAL-GAS-SERVICE','None - Building Has No Natural Gas Service',NULL,890),
  ('building_gas_utility','OTHER','Other',NULL,900)
) AS v(field, value, label, state, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values p
  WHERE p.picklist_object = 'buildings' AND p.picklist_field = v.field AND p.picklist_value = v.value);

-- ---------------------------------------------------------------------------
-- 2. Convert both columns to uuid FKs, carrying the hand-typed values across.
--    ALTER ... USING cannot contain a subquery, so the live text is captured
--    first and re-applied after the type change. Every captured value must
--    resolve to a seeded utility or the migration fails -- a value silently
--    dropped is a fact silently lost.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _building_utility_text ON COMMIT DROP AS
SELECT id, building_gas_utility AS gas_text, building_electric_utility AS electric_text
FROM buildings
WHERE building_gas_utility IS NOT NULL OR building_electric_utility IS NOT NULL;

ALTER TABLE buildings ALTER COLUMN building_gas_utility TYPE uuid USING NULL::uuid;
ALTER TABLE buildings ALTER COLUMN building_electric_utility TYPE uuid USING NULL::uuid;

ALTER TABLE buildings
  ADD CONSTRAINT buildings_building_gas_utility_fkey
  FOREIGN KEY (building_gas_utility) REFERENCES picklist_values(id);
ALTER TABLE buildings
  ADD CONSTRAINT buildings_building_electric_utility_fkey
  FOREIGN KEY (building_electric_utility) REFERENCES picklist_values(id);

SET session_replication_role = replica;

DO $$
BEGIN
  -- Match on the label, case- and punctuation-insensitively, within the
  -- building's own state where it has one. "WE Energies" is We Energies.
  UPDATE buildings b
  SET building_electric_utility = pv.id
  FROM _building_utility_text t
  JOIN picklist_values pv
    ON pv.picklist_object = 'buildings'
   AND pv.picklist_field = 'building_electric_utility'
   AND lower(regexp_replace(pv.picklist_label, '[^a-zA-Z0-9]', '', 'g'))
       = lower(regexp_replace(t.electric_text, '[^a-zA-Z0-9]', '', 'g'))
  WHERE b.id = t.id
    AND t.electric_text IS NOT NULL
    AND (pv.picklist_state IS NULL OR pv.picklist_state IS NOT DISTINCT FROM b.building_state);

  UPDATE buildings b
  SET building_gas_utility = pv.id
  FROM _building_utility_text t
  JOIN picklist_values pv
    ON pv.picklist_object = 'buildings'
   AND pv.picklist_field = 'building_gas_utility'
   AND lower(regexp_replace(pv.picklist_label, '[^a-zA-Z0-9]', '', 'g'))
       = lower(regexp_replace(t.gas_text, '[^a-zA-Z0-9]', '', 'g'))
  WHERE b.id = t.id
    AND t.gas_text IS NOT NULL
    AND (pv.picklist_state IS NULL OR pv.picklist_state IS NOT DISTINCT FROM b.building_state);

  -- "N/A" was somebody saying the building has no gas service.
  UPDATE buildings b
  SET building_gas_utility = pv.id
  FROM _building_utility_text t, picklist_values pv
  WHERE b.id = t.id
    AND b.building_gas_utility IS NULL
    AND upper(btrim(t.gas_text)) IN ('N/A','NA','NONE','NO GAS')
    AND pv.picklist_object = 'buildings'
    AND pv.picklist_field = 'building_gas_utility'
    AND pv.picklist_value = 'NO-NATURAL-GAS-SERVICE';
END $$;

SET session_replication_role = DEFAULT;

-- Nothing may be lost in the conversion.
DO $$
DECLARE v_unresolved text;
BEGIN
  SELECT string_agg(DISTINCT txt, ', ') INTO v_unresolved
  FROM (
    SELECT t.electric_text AS txt FROM _building_utility_text t
    JOIN buildings b ON b.id = t.id
    WHERE t.electric_text IS NOT NULL AND b.building_electric_utility IS NULL
    UNION ALL
    SELECT t.gas_text FROM _building_utility_text t
    JOIN buildings b ON b.id = t.id
    WHERE t.gas_text IS NOT NULL AND b.building_gas_utility IS NULL
  ) s;
  IF v_unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'utility value(s) did not resolve to a seeded utility: %', v_unresolved;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Declare the fields as picklists on every layout that carries them --
--    the building's own Utility Information section, and the enrollment /
--    incentive-application related fields that read them through building_id.
-- ---------------------------------------------------------------------------
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{fields}',
      (SELECT jsonb_agg(
                CASE
                  WHEN f->>'name' IN ('building_gas_utility','building_electric_utility')
                    THEN f || jsonb_build_object('type','picklist')
                  WHEN f->>'name' LIKE '%.building_gas_utility'
                    OR f->>'name' LIKE '%.building_electric_utility'
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
        WHERE e->>'name' IN ('building_gas_utility','building_electric_utility')
           OR e->>'name' LIKE '%.building_gas_utility'
           OR e->>'name' LIKE '%.building_electric_utility');

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'buildings'
    AND column_name IN ('building_gas_utility','building_electric_utility')
    AND data_type = 'uuid';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'expected both utility columns to be uuid, found % ', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field IN ('building_gas_utility','building_electric_utility')
    AND picklist_is_active;
  IF v_n < 60 THEN
    RAISE EXCEPTION 'expected the utility value sets to be seeded, found % value(s)', v_n;
  END IF;

  -- Every stated value must name a state EES actually operates in, and the
  -- two escape hatches must be offered everywhere.
  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field IN ('building_gas_utility','building_electric_utility')
    AND picklist_state IS NOT NULL
    AND picklist_state NOT IN ('WI','NC','CO','MI','IN');
  IF v_n > 0 THEN
    RAISE EXCEPTION '% utility value(s) carry a state outside the operating footprint', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM page_layouts l
  JOIN page_layout_sections s ON s.page_layout_id = l.id AND COALESCE(s.is_deleted,false) = false
  JOIN page_layout_widgets w ON w.section_id = s.id AND COALESCE(w.is_deleted,false) = false
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE COALESCE(l.is_deleted,false) = false
    AND f->>'name' IN ('building_gas_utility','building_electric_utility')
    AND COALESCE(f->>'type','') <> 'picklist';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% layout field(s) still declare the utility columns as something other than a picklist', v_n;
  END IF;
END $$;

