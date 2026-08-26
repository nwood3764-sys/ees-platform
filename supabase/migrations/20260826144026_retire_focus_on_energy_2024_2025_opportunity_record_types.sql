-- ---------------------------------------------------------------------------
-- Retire the expired Focus on Energy program years as opportunity record types.
--
-- Nicholas, 2026-08-26, from the New Opportunity pop-up on BLD-00150 (a 24-unit
-- Milwaukee multifamily building): "the old focus on energy from 24 and 25
-- should not be on there."
--
-- A Focus on Energy program year is exactly that -- a year. FOE-2024-WI and
-- FOE-2025-WI are closed program years; a new opportunity can no longer be
-- enrolled in either, so offering them is offering a program that cannot pay.
-- FOE-2026-WI is the year that is open and stays.
--
-- INACTIVE, NOT DELETED -- the same call Nicholas made on 2026-08-23 for the two
-- generic assessment types: a retired record type disappears from every picker
-- but stays on the records that already carry it, keeps its stage set, and can
-- be reactivated if a program year is reopened. Both years carry ZERO live
-- opportunities today, which is asserted below rather than assumed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_live_count integer;
  v_retired    integer;
BEGIN
  SELECT count(*) INTO v_live_count
    FROM public.opportunities o
    JOIN public.picklist_values pv ON pv.id = o.opportunity_record_type
   WHERE o.opportunity_is_deleted IS NOT TRUE
     AND pv.picklist_object = 'opportunities'
     AND pv.picklist_field  = 'record_type'
     AND pv.picklist_value IN ('FOE-2024-WI', 'FOE-2025-WI');

  IF v_live_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to retire FOE-2024-WI / FOE-2025-WI: % live opportunities still carry them. Move those to the program they belong to first (the five NC rows were moved on 2026-08-24).',
      v_live_count;
  END IF;

  UPDATE public.picklist_values
     SET picklist_is_active = false,
         picklist_description = COALESCE(picklist_description || ' ', '')
           || 'Retired 2026-08-26: closed Focus on Energy program year. Kept for the records that carry it; FOE-2026-WI is the open year.'
   WHERE picklist_object = 'opportunities'
     AND picklist_field  = 'record_type'
     AND picklist_value IN ('FOE-2024-WI', 'FOE-2025-WI')
     AND picklist_is_active;
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  RAISE NOTICE 'Retired % Focus on Energy program-year record type(s).', v_retired;

  -- The platform default must never land on a retired program year.
  IF EXISTS (
    SELECT 1 FROM public.picklist_values
     WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type'
       AND picklist_is_default_record_type
       AND NOT picklist_is_active
  ) THEN
    RAISE EXCEPTION 'The default opportunity record type is inactive after this change.';
  END IF;
END $$;
