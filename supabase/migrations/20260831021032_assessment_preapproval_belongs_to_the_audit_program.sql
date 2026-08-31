-- The assessment preapproval enrollment belongs to the AUDIT program
--
-- The previous migration derived a program's own enrollment types by value
-- prefix, and "WI-IRA-MF-HOMES-%" matches BOTH of the HOMES enrollment types --
-- so WI-IRA-MF-HOMES came out offering the assessment preapproval as well as the
-- project reservation. The live data says otherwise and is the only evidence
-- there is: all 17 assessment preapprovals sit on WI-IRA-MF-HOMES-AUDIT
-- opportunities and none on WI-IRA-MF-HOMES. An assessment is the AUDIT
-- program's own work -- the same ruling made on 2026-08-23 when the five
-- FOE-2024-WI opportunities were moved to NC-IRA-SF-HOMES-AUDIT.
--
-- Soft-deleted, not hard-deleted, and reversible from Object Manager if the
-- preapproval turns out to be creatable on the HOMES program too. Flagged for
-- Nicholas rather than left silently wide.

UPDATE record_type_eligibility e
   SET rte_is_active = false,
       rte_is_deleted = true
  FROM picklist_values par, picklist_values chi
 WHERE e.rte_parent_object = 'opportunities'
   AND e.rte_parent_record_type_id = par.id
   AND e.rte_child_object = 'enrollments'
   AND e.rte_child_record_type_id = chi.id
   AND par.picklist_value = 'WI-IRA-MF-HOMES'
   AND chi.picklist_value = 'WI-IRA-MF-HOMES-Assessment-Preapproval'
   AND e.rte_is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_homes uuid;
  v_audit uuid;
  v_hear  uuid;
  v_list  text;
BEGIN
  SELECT id INTO v_homes FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HOMES';
  SELECT id INTO v_audit FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HOMES-AUDIT';
  SELECT id INTO v_hear FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HEAR';

  SELECT string_agg(x.picklist_value, ', ' ORDER BY x.picklist_value) INTO v_list
    FROM eligible_record_types_for_parent('opportunities', v_homes, 'enrollments') x;
  IF v_list IS DISTINCT FROM 'WI-IRA-MF-HOMES-Project-Reservation' THEN
    RAISE EXCEPTION 'WI-IRA-MF-HOMES should offer only its project reservation, offers: %', v_list;
  END IF;

  SELECT string_agg(x.picklist_value, ', ' ORDER BY x.picklist_value) INTO v_list
    FROM eligible_record_types_for_parent('opportunities', v_audit, 'enrollments') x;
  IF v_list NOT LIKE '%WI-IRA-MF-HOMES-Assessment-Preapproval%' THEN
    RAISE EXCEPTION 'The audit program lost its assessment preapproval, offers: %', v_list;
  END IF;

  SELECT string_agg(x.picklist_value, ', ' ORDER BY x.picklist_value) INTO v_list
    FROM eligible_record_types_for_parent('opportunities', v_hear, 'enrollments') x;
  IF v_list IS DISTINCT FROM 'WI-IRA-MF-HEAR-Project-Reservation' THEN
    RAISE EXCEPTION 'WI-IRA-MF-HEAR should offer only its project reservation, offers: %', v_list;
  END IF;
END $$;
