-- =============================================================================
-- Retire the eligibility edges that point at a record type nobody can choose.
--
-- Nicholas, 2026-08-29: "fix the eligibility matrix."
--
-- record_type_eligibility carried 31 active edges naming a record type that is
-- no longer active. They were never a functional defect — every reader filters
-- on picklist_is_active, so a retired program was never offered — but they are
-- noise in Setup -> Object Manager -> Record Types, where the matrix is read
-- and edited by hand.
--
-- ONLY the edges whose CHILD is retired and whose PARENT is still live are
-- removed, and only where no live record actually uses the pair. The rest are
-- deliberately left, for two independent reasons:
--
-- 1. AN EMPTY EDGE SET MEANS UNCONSTRAINED, NOT FORBIDDEN.
--    eligible_record_types_for_parent and record_type_eligible both treat a
--    (parent_object, parent_record_type, child_object) triple with no active
--    edges as "nothing is configured here, so allow everything". So removing
--    EVERY edge under a parent does not tighten that parent — it throws its
--    constraint away. That is exactly what would happen to the 14 edges under
--    the retired building type NEW-CONSTRUCTION-SINGLE-FAMILY and the 2 under
--    the retired opportunity types FOE-2024-WI / FOE-2025-WI, which are all the
--    edges those parents have. Harmless while they are inactive; a silent hole
--    the day one is switched back on. Tidying them away would be a workaround
--    that looks like cleanup.
--
-- 2. A RETIRED PROGRAM STILL ON LIVE RECORDS STILL NEEDS ITS EDGE.
--    9 live opportunities carry SINGLE-FAMILY-ENERGY-ASSESSMENT — 8 on
--    SINGLE-FAMILY-ATTACHED buildings and 1 on SINGLE-FAMILY-DETACHED.
--    trg_zz_opportunity_record_type_building fires on UPDATE OF
--    opportunity_record_type, building_id, so dropping those two edges would
--    make those 9 records impossible to move to another building or repoint —
--    the record type they already carry would be refused as ineligible. The
--    edge is what keeps an existing record editable, so it stays until the
--    records themselves are moved.
--
-- Both exclusions are computed from the data, not listed by hand, so this stays
-- correct if the underlying facts change before it is replayed.
-- =============================================================================

DO $$
DECLARE
  v_removed  int;
  v_unguarded int;
BEGIN
  WITH dead AS (
    SELECT e.id
      FROM public.record_type_eligibility e
      JOIN public.picklist_values p ON p.id = e.rte_parent_record_type_id
      JOIN public.picklist_values c ON c.id = e.rte_child_record_type_id
     WHERE e.rte_is_active AND NOT e.rte_is_deleted
       -- the program is retired...
       AND NOT c.picklist_is_active
       -- ...but the thing it hangs off is not, so the parent keeps a constraint
       AND p.picklist_is_active
       -- ...and nothing live is relying on the pair to stay editable
       AND NOT EXISTS (
         SELECT 1
           FROM public.opportunities o
           JOIN public.buildings b ON b.id = o.building_id
          WHERE e.rte_parent_object = 'buildings'
            AND e.rte_child_object  = 'opportunities'
            AND b.building_record_type   = e.rte_parent_record_type_id
            AND o.opportunity_record_type = e.rte_child_record_type_id
            AND NOT o.opportunity_is_deleted
       )
  )
  UPDATE public.record_type_eligibility e
     SET rte_is_active = false
    FROM dead
   WHERE e.id = dead.id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- The failure mode this whole migration has to avoid: a parent left with no
  -- active edges is UNCONSTRAINED, which is wider than before, not narrower.
  SELECT count(*) INTO v_unguarded
    FROM (
      SELECT e.rte_parent_object, e.rte_parent_record_type_id, e.rte_child_object
        FROM public.record_type_eligibility e
        JOIN public.picklist_values p ON p.id = e.rte_parent_record_type_id
       WHERE NOT e.rte_is_deleted AND p.picklist_is_active
       GROUP BY 1, 2, 3
      HAVING count(*) FILTER (WHERE e.rte_is_active) = 0
    ) t;

  RAISE NOTICE 'record_type_eligibility: % dead edges retired', v_removed;

  IF v_unguarded > 0 THEN
    RAISE EXCEPTION
      'aborting: % live parent record type(s) would be left with no active edges, which means UNCONSTRAINED',
      v_unguarded;
  END IF;
END
$$;
