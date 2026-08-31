-- Every IRA program constrains its enrollment record types, not just the four
--
-- The previous migration registered enrollments in record_type_eligibility and
-- configured the four programs that had live enrollments. That left the other
-- fifteen opportunity record types with no edges -- and an object with no edges
-- is unconstrained, so a Wisconsin single-family HEAR opportunity still offered
-- every enrollment type in the platform, Michigan's and North Carolina's
-- included. Nicholas's rule is absolute ("It's just not possible"), so a
-- half-configured map is not the rule holding; it is the rule holding in four
-- places.
--
-- THE RULE, stated once so it is not re-derived later:
--   A program offers its OWN enrollment record types when it has any.
--   When it has none, it offers the generic type for its state and segment
--   (WI-IRA-SF, NC-IRA-MF, ...), which is the only enrollment type that exists
--   for those programs today.
-- Nothing new is invented: no enrollment record type is created here. Where a
-- program-specific type exists it wins outright, which is why WI-IRA-MF-HEAR
-- still offers exactly one thing -- its own project reservation -- rather than
-- gaining the generic WI-IRA-MF beside it.
--
-- Non-IRA opportunity types (FIELD-OPERATIONS, FOE-2026-WI) are deliberately
-- left with no edges. Nicholas: "you should only be able to do an IRA
-- enrollment." Enrollment is an IRA-program artifact; Focus on Energy and field
-- operations do not enroll. Leaving them unconfigured keeps them unconstrained
-- rather than blocked, which is the conservative half of that -- turning "no
-- edges" into "nothing allowed" would be a platform-wide behaviour change
-- affecting every object in the eligibility system, and that is its own
-- decision, recorded rather than taken here.

WITH ira_program AS (
  SELECT rt.id,
         rt.picklist_value,
         split_part(rt.picklist_value, '-', 1) AS state_code,
         split_part(rt.picklist_value, '-', 3) AS segment
  FROM picklist_values rt
  WHERE rt.picklist_object = 'opportunities'
    AND rt.picklist_field  = 'record_type'
    AND rt.picklist_is_active
    AND rt.picklist_value ~ '^(WI|NC|MI)-IRA-(MF|SF)-'
),
-- A program's own enrollment types: those whose value begins with the program's
-- value (WI-IRA-MF-HEAR -> WI-IRA-MF-HEAR-Project-Reservation).
specific AS (
  SELECT p.id AS parent_id, ce.id AS child_id
  FROM ira_program p
  JOIN picklist_values ce
    ON ce.picklist_object = 'enrollments' AND ce.picklist_field = 'record_type'
   AND ce.picklist_is_active
   AND ce.picklist_value LIKE p.picklist_value || '-%'
),
-- The state+segment generic, used only where the program has none of its own.
generic AS (
  SELECT p.id AS parent_id, ce.id AS child_id
  FROM ira_program p
  JOIN picklist_values ce
    ON ce.picklist_object = 'enrollments' AND ce.picklist_field = 'record_type'
   AND ce.picklist_is_active
   AND ce.picklist_value = p.state_code || '-IRA-' || p.segment
  WHERE NOT EXISTS (SELECT 1 FROM specific s WHERE s.parent_id = p.id)
),
wanted AS (
  SELECT * FROM specific
  UNION
  SELECT * FROM generic
)
INSERT INTO record_type_eligibility (
  rte_record_number, rte_parent_object, rte_parent_record_type_id,
  rte_child_object, rte_child_record_type_id, rte_is_active
)
SELECT '', 'opportunities', w.parent_id, 'enrollments', w.child_id, true
FROM wanted w
WHERE NOT EXISTS (
  SELECT 1 FROM record_type_eligibility e
  WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = w.parent_id
    AND e.rte_child_object = 'enrollments' AND e.rte_child_record_type_id = w.child_id
    AND e.rte_is_deleted IS NOT TRUE
);

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_rt    record;
  v_count integer;
  v_bad   integer;
  v_hear  uuid;
BEGIN
  -- Every active IRA program now constrains its enrollment types.
  FOR v_rt IN
    SELECT rt.id, rt.picklist_value
    FROM picklist_values rt
    WHERE rt.picklist_object='opportunities' AND rt.picklist_field='record_type'
      AND rt.picklist_is_active AND rt.picklist_value ~ '^(WI|NC|MI)-IRA-(MF|SF)-'
    ORDER BY rt.picklist_value
  LOOP
    SELECT count(*) INTO v_count
      FROM eligible_record_types_for_parent('opportunities', v_rt.id, 'enrollments');
    IF v_count = 0 THEN
      RAISE EXCEPTION '% still offers no enrollment record type', v_rt.picklist_value;
    END IF;

    -- and never one from another state or the other segment
    SELECT count(*) INTO v_bad
      FROM eligible_record_types_for_parent('opportunities', v_rt.id, 'enrollments') x
     WHERE split_part(x.picklist_value, '-', 1) <> split_part(v_rt.picklist_value, '-', 1)
        OR split_part(x.picklist_value, '-', 3) <> split_part(v_rt.picklist_value, '-', 3);
    IF v_bad > 0 THEN
      RAISE EXCEPTION '% offers % enrollment type(s) from another state or segment',
        v_rt.picklist_value, v_bad;
    END IF;
  END LOOP;

  -- The case that started this: still exactly one, still the HEAR reservation.
  SELECT id INTO v_hear FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HEAR';
  SELECT count(*) INTO v_count
    FROM eligible_record_types_for_parent('opportunities', v_hear, 'enrollments');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'WI-IRA-MF-HEAR now offers % enrollment types, expected 1', v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM eligible_record_types_for_parent('opportunities', v_hear, 'enrollments') x
     WHERE x.picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation'
  ) THEN
    RAISE EXCEPTION 'WI-IRA-MF-HEAR does not offer its own project reservation';
  END IF;

  -- No existing enrollment is invalidated.
  SELECT count(*) INTO v_bad
    FROM enrollments e
    JOIN opportunities o ON o.id = e.opportunity_id
   WHERE e.enrollment_is_deleted IS NOT TRUE
     AND e.enrollment_record_type IS NOT NULL
     AND o.opportunity_record_type IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM record_type_eligibility r
       WHERE r.rte_parent_object='opportunities'
         AND r.rte_parent_record_type_id = o.opportunity_record_type
         AND r.rte_child_object='enrollments'
         AND r.rte_is_active AND NOT r.rte_is_deleted)
     AND NOT record_type_eligible('opportunities', o.opportunity_record_type,
                                  'enrollments', e.enrollment_record_type);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% existing enrollments would be invalid', v_bad;
  END IF;
END $$;
