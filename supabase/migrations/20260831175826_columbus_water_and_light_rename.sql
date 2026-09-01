-- Columbus Utilities is renamed to its real branded name, Columbus Water and Light.
--
-- Nicholas, on 20260831172128 shipping: "Sure, name it Columbus Water and
-- Light. That's fine." Columbus, Wisconsin is served by the municipal utility
-- branded Columbus Water and Light; "Columbus Utilities" was the working name
-- the value was seeded under earlier today.
--
-- BOTH the label and the stable value key are renamed, which is only correct
-- because nothing points at it yet -- verified 0 buildings carry the value
-- (it was seeded ~30 minutes before this). buildings.building_electric_utility
-- is a uuid FK to picklist_values.id, so the row's identity is its id and no
-- FK could break either way; the value key is renamed for the set's own
-- consistency, since every other member spells its key from its label
-- (WI-MADISON-GAS-AND-ELECTRIC / "Madison Gas and Electric" -- note that set
-- spells "AND" out, which is the spelling followed here).
--
-- Had any building referenced it, the label alone would move and the key would
-- stay: a stable key that live data is keyed on is not renamed for cosmetics.
--
-- Sort order 65 is unchanged -- still after the named Wisconsin utilities and
-- before the generic Municipal Electric Utility (70) / Electric Cooperative
-- (80) catch-alls. State stays WI.

-- ---------------------------------------------------------------------------
-- 1. Refuse to run if the premise no longer holds.
--    A building that started using the value between the two migrations makes
--    the key rename the wrong call, so stop rather than quietly reshaping it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM buildings b
  JOIN picklist_values p ON p.id = b.building_electric_utility
  WHERE p.picklist_object = 'buildings'
    AND p.picklist_field  = 'building_electric_utility'
    AND p.picklist_value  = 'WI-COLUMBUS-UTILITIES';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      '% building(s) already reference WI-COLUMBUS-UTILITIES; rename the label only and leave the key alone', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field  = 'building_electric_utility'
    AND picklist_value  = 'WI-COLUMBUS-WATER-AND-LIGHT';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'WI-COLUMBUS-WATER-AND-LIGHT already exists; renaming would collide';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Rename in place. The row keeps its id, so this is a rename and not a
--    retire-and-reseed -- there is no second row for anyone to pick.
-- ---------------------------------------------------------------------------
UPDATE picklist_values
SET picklist_value = 'WI-COLUMBUS-WATER-AND-LIGHT',
    picklist_label = 'Columbus Water and Light'
WHERE picklist_object = 'buildings'
  AND picklist_field  = 'building_electric_utility'
  AND picklist_value  = 'WI-COLUMBUS-UTILITIES';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field  = 'building_electric_utility'
    AND picklist_value  = 'WI-COLUMBUS-WATER-AND-LIGHT'
    AND picklist_label  = 'Columbus Water and Light'
    AND picklist_state  = 'WI'
    AND picklist_sort_order = 65
    AND picklist_is_active;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one active WI Columbus Water and Light value, found %', v_n;
  END IF;

  -- The old name must be gone entirely, not merely deactivated -- two rows for
  -- one utility is how the same company ends up spelled three ways.
  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field  = 'building_electric_utility'
    AND (picklist_value = 'WI-COLUMBUS-UTILITIES' OR picklist_label = 'Columbus Utilities');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'the old Columbus Utilities value is still present (% row(s))', v_n;
  END IF;

  -- The Wisconsin set is still nine utilities -- a rename must not add or drop.
  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field  = 'building_electric_utility'
    AND picklist_state  = 'WI'
    AND picklist_is_active;
  IF v_n <> 9 THEN
    RAISE EXCEPTION 'expected 9 active Wisconsin electric utilities after the rename, found %', v_n;
  END IF;
END $$;
