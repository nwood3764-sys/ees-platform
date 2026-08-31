-- Columbus Utilities joins the Wisconsin electric utility value set.
--
-- Nicholas: "add a new electric provider for Wisconsin called Columbus
-- Utilities -- this should show up anywhere that there is an electric utility
-- drop-down pick list."
--
-- There is exactly ONE electric-utility picklist in LEAP:
-- (picklist_object='buildings', picklist_field='building_electric_utility'),
-- seeded by 20260829215419. Every electric-utility drop-down in the platform
-- renders that one value set -- the building's own Utility Information
-- section, and the enrollment / incentive-application layouts that read it
-- through building_id as a related field (their layout entries carry
-- related.column_type='picklist', so they resolve the same rows). The other
-- columns that read like a utility -- properties.property_electric_utility,
-- units.unit_electric_utility, buildings.building_electric_fuel_provider,
-- assessments.assessment_electric_fuel_provider -- are plain text and render
-- as text boxes, not drop-downs; a value added here cannot reach them and
-- converting them is a separate change, not this one.
--
-- So one row is the whole change, and that is the point of a picklist:
-- adding a utility is data, not a deploy. (picklist_values carries no
-- soft-delete column -- a retired value is picklist_is_active = false -- so
-- that is what the assertions below check.)
--
-- Placement: sort 65 puts it after the named Wisconsin utilities and BEFORE
-- the generic "Municipal Electric Utility" (70) / "Electric Cooperative" (80)
-- catch-alls, so the catch-alls stay at the bottom of the list where a reader
-- expects them. State 'WI' scopes it to Wisconsin buildings, exactly as the
-- rest of the set is scoped -- a Rocky Mount building is not offered it.
--
-- No picklist_value_record_type_assignments rows are written, deliberately:
-- this field has none (verified 0 live), and per the 2026-08-16 rule a field
-- with NO record-type selection offers every active value under every record
-- type. Adding assignments here would make the field strict and hide the
-- other 8 Wisconsin utilities from every building.

INSERT INTO picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_state,
   picklist_is_active, picklist_sort_order)
SELECT 'buildings', 'building_electric_utility', 'WI-COLUMBUS-UTILITIES',
       'Columbus Utilities', 'WI', true, 65
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values p
  WHERE p.picklist_object = 'buildings'
    AND p.picklist_field  = 'building_electric_utility'
    AND p.picklist_value  = 'WI-COLUMBUS-UTILITIES');

-- ---------------------------------------------------------------------------
-- Assert the outcome: the value exists, is active, is scoped to Wisconsin,
-- and is actually offered by the RPC the drop-downs call.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field  = 'building_electric_utility'
    AND picklist_value  = 'WI-COLUMBUS-UTILITIES'
    AND picklist_label  = 'Columbus Utilities'
    AND picklist_state  = 'WI'
    AND picklist_is_active;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one active Wisconsin Columbus Utilities value, found %', v_n;
  END IF;

  -- The rest of the Wisconsin electric set must still be offered -- an added
  -- value that narrows the list is the failure mode worth catching.
  SELECT count(*) INTO v_n
  FROM picklist_values
  WHERE picklist_object = 'buildings'
    AND picklist_field  = 'building_electric_utility'
    AND picklist_state  = 'WI'
    AND picklist_is_active;
  IF v_n <> 9 THEN
    RAISE EXCEPTION 'expected 9 active Wisconsin electric utilities after the add, found %', v_n;
  END IF;

  -- This field must remain unscoped by record type, or the strict branch of
  -- picklist_values_for_record_type would hide every value with no assignment.
  SELECT count(*) INTO v_n
  FROM picklist_value_record_type_assignments a
  JOIN picklist_values p ON p.id = a.pvrta_picklist_value_id
  WHERE p.picklist_object = 'buildings'
    AND p.picklist_field  = 'building_electric_utility'
    AND COALESCE(a.pvrta_is_deleted, false) = false;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'building_electric_utility has become record-type scoped (% assignment row(s)); the new value would be hidden', v_n;
  END IF;
END $$;
