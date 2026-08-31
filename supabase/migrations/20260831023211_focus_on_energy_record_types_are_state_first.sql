-- Focus on Energy opportunity record types are named state first
--
-- Nicholas: "It needs to be WI-FOE-2026. I don't know how that got named wrong.
-- It's always the biggest to smallest. State, program, year."
--
-- Every other opportunity record type on the platform already reads state first
-- -- WI-IRA-MF-HEAR, NC-IRA-SF-HOMES-AUDIT, MI-IRA-MF-HOMES -- and so does the
-- Focus on Energy INCENTIVE APPLICATION record type, WI-FOE. The three Focus on
-- Energy opportunity types were the only ones written program-first, so the odd
-- one out is corrected rather than the convention re-argued:
--   FOE-2024-WI -> WI-FOE-2024
--   FOE-2025-WI -> WI-FOE-2025
--   FOE-2026-WI -> WI-FOE-2026
-- All three, not just 2026 -- a convention that holds for one row of three is
-- not a convention, and 2024/2025 are inactive with zero live opportunities, so
-- there is nothing to weigh against consistency.
--
-- SAFE BECAUSE NOTHING JOINS ON THE STRING. Record types are referenced by id
-- everywhere in the database: opportunities.opportunity_record_type,
-- record_type_eligibility, opportunity_record_type_price_books, page_layouts.
-- No function, policy or trigger body mentions these values (checked against
-- pg_proc.prosrc). The one place the string is a key is the client's
-- paperworkSubmittals.js program matrix, updated in the same change.
--
-- The four live FOE-2026 opportunities keep their record type -- this renames the
-- picklist row they already point at, so no record is reassigned and no history
-- is rewritten. Their derived names recompose on the next write of each
-- opportunity, since derive_opportunity_name() appends the record type label.

UPDATE picklist_values
   SET picklist_value = 'WI-FOE-' || split_part(picklist_value, '-', 2),
       picklist_label = 'WI-FOE-' || split_part(picklist_value, '-', 2)
 WHERE picklist_object = 'opportunities'
   AND picklist_field  = 'record_type'
   AND picklist_value IN ('FOE-2024-WI', 'FOE-2025-WI', 'FOE-2026-WI');

DO $$
DECLARE
  v_old   integer;
  v_new   integer;
  v_live  integer;
  v_state text;
BEGIN
  SELECT count(*) INTO v_old FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='record_type'
     AND picklist_value LIKE 'FOE-%';
  IF v_old > 0 THEN
    RAISE EXCEPTION '% Focus on Energy record types are still named program-first', v_old;
  END IF;

  SELECT count(*) INTO v_new FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='record_type'
     AND picklist_value IN ('WI-FOE-2024','WI-FOE-2025','WI-FOE-2026');
  IF v_new <> 3 THEN
    RAISE EXCEPTION 'Expected 3 renamed Focus on Energy record types, found %', v_new;
  END IF;

  -- The live opportunities still point at the same row, still in Wisconsin.
  SELECT count(*), max(pv.picklist_state) INTO v_live, v_state
    FROM opportunities o
    JOIN picklist_values pv ON pv.id = o.opportunity_record_type
   WHERE pv.picklist_value = 'WI-FOE-2026' AND o.opportunity_is_deleted IS NOT TRUE;
  IF v_live <> 4 THEN
    RAISE EXCEPTION 'Expected 4 live WI-FOE-2026 opportunities, found %', v_live;
  END IF;
  IF v_state IS DISTINCT FROM 'WI' THEN
    RAISE EXCEPTION 'WI-FOE-2026 lost its state scoping (got %)', v_state;
  END IF;

  -- Its price book mapping survives, because that join is on the id.
  IF NOT EXISTS (
    SELECT 1 FROM opportunity_record_type_price_books m
    JOIN picklist_values pv ON pv.id = m.ortpb_record_type_id
    WHERE pv.picklist_value = 'WI-FOE-2026' AND m.ortpb_is_deleted IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'WI-FOE-2026 lost its price book mapping';
  END IF;
END $$;
