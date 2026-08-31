-- Enrollment record types are governed by the opportunity's record type
--
-- Nicholas, from the New Enrollment picker on a WI-IRA-MF-HEAR opportunity that
-- was offering WI-IRA-MF-HOMES-Assessment-Preapproval, WI-IRA-MF-HOMES-Project-
-- Reservation and WI-IRA-SF: "our opportunity types and the record types for
-- enrollments, projects, and incentive applications have to be filtered by the
-- opportunity record type. No one should be able to put a HOMES enrollment on a
-- HEAR opportunity. It's just not possible. It's all record type driven."
--
-- The mechanism already existed and enrollments were simply never registered in
-- it. record_type_eligibility governs opportunities -> assessments (6 edges) and
-- opportunities -> incentive_applications (24 edges); it had ZERO edges for
-- enrollments, and an object with no edges is unconstrained, so every active
-- enrollment record type in the state was on offer. This registers the missing
-- object rather than inventing a second filtering mechanism beside the first.
--
-- The client needs no change: fetchConstrainingParentForCreate() already reads
-- which parent governs a child straight out of record_type_eligibility, for any
-- child object. Seeding the edges is what filters the picker.
--
-- WHICH PAIRINGS -- taken from the live data, not guessed. Every enrollment on
-- prod today sits on an opportunity of the matching program:
--   WI-IRA-MF-HOMES-Assessment-Preapproval (17) on WI-IRA-MF-HOMES-AUDIT
--   WI-IRA-MF-HOMES-Project-Reservation     (7) on WI-IRA-MF-HOMES
--   NC-IRA-MF                               (7) on NC-IRA-MF-HOMES
--   WI-IRA-MF                               (1) on WI-IRA-MF-HOMES-AUDIT
-- Those four pairings are seeded so no existing record becomes invalid, plus the
-- new HEAR one. NO grandfather clause is needed as a result, and none is added:
-- per the 2026-08-24 ruling a mismatch must be impossible, not merely un-offered.
--
-- The assessment preapproval belongs to the AUDIT program and the project
-- reservation to the HOMES program -- that is the real structure and it is why
-- these are two edges from two different parents, not one parent with two
-- children.
--
-- WI-IRA-MF and NC-IRA-MF are the pre-program generic types. They are kept
-- eligible only where records already use them; they are NOT offered anywhere
-- else, and in particular never on a HEAR opportunity. Whether to retire them
-- and migrate those 8 rows onto program-specific types is a data decision left
-- for Nicholas rather than made here.

-- 1. The edges ---------------------------------------------------------------
WITH pairing(parent_value, child_value) AS (
  VALUES
    -- The program-specific pairings.
    ('WI-IRA-MF-HEAR',       'WI-IRA-MF-HEAR-Project-Reservation'),
    ('WI-IRA-MF-HOMES',      'WI-IRA-MF-HOMES-Project-Reservation'),
    ('WI-IRA-MF-HOMES-AUDIT','WI-IRA-MF-HOMES-Assessment-Preapproval'),
    -- Pre-program generic types, kept eligible only where live records use them.
    ('WI-IRA-MF-HOMES-AUDIT','WI-IRA-MF'),
    ('NC-IRA-MF-HOMES',      'NC-IRA-MF')
)
INSERT INTO record_type_eligibility (
  rte_record_number, rte_parent_object, rte_parent_record_type_id,
  rte_child_object, rte_child_record_type_id, rte_is_active
)
SELECT '', 'opportunities', par.id, 'enrollments', chi.id, true
FROM pairing p
JOIN picklist_values par
  ON par.picklist_object = 'opportunities' AND par.picklist_field = 'record_type'
 AND par.picklist_value = p.parent_value
JOIN picklist_values chi
  ON chi.picklist_object = 'enrollments' AND chi.picklist_field = 'record_type'
 AND chi.picklist_value = p.child_value
WHERE NOT EXISTS (
  SELECT 1 FROM record_type_eligibility e
  WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = par.id
    AND e.rte_child_object = 'enrollments' AND e.rte_child_record_type_id = chi.id
    AND e.rte_is_deleted IS NOT TRUE
);

-- 2. Derive the record type from the opportunity when none was supplied ------
-- Named trg_0_ so it sorts before trg_enforce_record_type, which would otherwise
-- stamp the object's platform default -- the same ordering the incentive
-- application derivation needed.
CREATE OR REPLACE FUNCTION derive_enrollment_record_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_catalog'
AS $fn$
DECLARE
  v_opp_rt uuid;
  v_pick   uuid;
  v_count  integer;
BEGIN
  IF NEW.enrollment_record_type IS NOT NULL OR NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.opportunity_record_type INTO v_opp_rt
    FROM public.opportunities o WHERE o.id = NEW.opportunity_id;
  IF v_opp_rt IS NULL THEN RETURN NEW; END IF;

  -- Only when the program leaves no choice. With several eligible types the
  -- stage is a real decision (preapproval vs reservation) and guessing one
  -- would file the enrollment against the wrong stage silently.
  SELECT count(*) INTO v_count
    FROM public.eligible_record_types_for_parent(
           'opportunities', v_opp_rt, 'enrollments');
  IF v_count = 1 THEN
    SELECT e.id INTO v_pick
      FROM public.eligible_record_types_for_parent(
             'opportunities', v_opp_rt, 'enrollments') e
     LIMIT 1;
    NEW.enrollment_record_type := v_pick;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION derive_enrollment_record_type() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_0_enrollment_record_type_from_opportunity ON enrollments;
CREATE TRIGGER trg_0_enrollment_record_type_from_opportunity
  BEFORE INSERT ON enrollments
  FOR EACH ROW EXECUTE FUNCTION derive_enrollment_record_type();

-- 3. Refuse a record type the opportunity's program does not run -------------
CREATE OR REPLACE FUNCTION enforce_enrollment_record_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_catalog'
AS $fn$
DECLARE
  v_parent_rt uuid;
  v_rt_label  text;
  v_opp_label text;
  v_allowed   text;
BEGIN
  IF NEW.enrollment_record_type IS NULL OR NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT opportunity_record_type INTO v_parent_rt
    FROM public.opportunities WHERE id = NEW.opportunity_id;
  IF v_parent_rt IS NULL THEN RETURN NEW; END IF;

  -- An opportunity program with no edges configured constrains nothing, so a
  -- program nobody has set up yet does not become unusable overnight.
  IF NOT EXISTS (
    SELECT 1 FROM public.record_type_eligibility e
    WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = v_parent_rt
      AND e.rte_child_object = 'enrollments'
      AND e.rte_is_active AND NOT e.rte_is_deleted
  ) THEN
    RETURN NEW;
  END IF;

  IF public.record_type_eligible(
       'opportunities', v_parent_rt, 'enrollments', NEW.enrollment_record_type) THEN
    RETURN NEW;
  END IF;

  SELECT picklist_label INTO v_rt_label
    FROM public.picklist_values WHERE id = NEW.enrollment_record_type;
  SELECT picklist_label INTO v_opp_label
    FROM public.picklist_values WHERE id = v_parent_rt;
  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.record_type_eligibility e
    JOIN public.picklist_values pv ON pv.id = e.rte_child_record_type_id
   WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = v_parent_rt
     AND e.rte_child_object = 'enrollments'
     AND e.rte_is_active AND NOT e.rte_is_deleted;

  RAISE EXCEPTION
    'Enrollment record type "%" is not part of the "%" program. Allowed here: %.',
    COALESCE(v_rt_label, '(unknown)'), COALESCE(v_opp_label, '(unknown)'),
    COALESCE(v_allowed, '(none configured)');
END;
$fn$;

REVOKE ALL ON FUNCTION enforce_enrollment_record_type() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_enrollment_record_type_program ON enrollments;
CREATE TRIGGER trg_zz_enrollment_record_type_program
  BEFORE INSERT OR UPDATE OF enrollment_record_type, opportunity_id ON enrollments
  FOR EACH ROW EXECUTE FUNCTION enforce_enrollment_record_type();

NOTIFY pgrst, 'reload schema';

-- 4. Prove it ----------------------------------------------------------------
DO $$
DECLARE
  v_hear_opp uuid;
  v_hear_rt  uuid;
  v_homes_pr uuid;
  v_hear_pr  uuid;
  v_count    integer;
  v_bad      integer;
BEGIN
  SELECT id INTO v_hear_rt FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HEAR';
  SELECT id INTO v_homes_pr FROM picklist_values
   WHERE picklist_object='enrollments' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HOMES-Project-Reservation';
  SELECT id INTO v_hear_pr FROM picklist_values
   WHERE picklist_object='enrollments' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HEAR-Project-Reservation';

  -- A HEAR opportunity offers exactly one enrollment type: its own reservation.
  SELECT count(*) INTO v_count
    FROM eligible_record_types_for_parent('opportunities', v_hear_rt, 'enrollments');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'WI-IRA-MF-HEAR offers % enrollment record types, expected 1', v_count;
  END IF;
  IF NOT record_type_eligible('opportunities', v_hear_rt, 'enrollments', v_hear_pr) THEN
    RAISE EXCEPTION 'The HEAR reservation is not eligible on a HEAR opportunity';
  END IF;
  IF record_type_eligible('opportunities', v_hear_rt, 'enrollments', v_homes_pr) THEN
    RAISE EXCEPTION 'A HOMES enrollment is still eligible on a HEAR opportunity';
  END IF;

  -- Every enrollment already on prod stays valid under the new rule.
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
    RAISE EXCEPTION '% existing enrollments would be invalid under the new rule', v_bad;
  END IF;

  -- And the trigger actually refuses the case he named.
  SELECT o.id INTO v_hear_opp
    FROM opportunities o
   WHERE o.opportunity_record_type = v_hear_rt
     AND o.opportunity_is_deleted IS NOT TRUE
   LIMIT 1;
  IF v_hear_opp IS NOT NULL THEN
    BEGIN
      INSERT INTO enrollments (
        enrollment_record_number, enrollment_name, opportunity_id,
        enrollment_record_type, enrollment_owner, enrollment_created_by
      )
      VALUES ('', 'RULE PROBE — must not persist', v_hear_opp, v_homes_pr,
              (SELECT id FROM users WHERE user_is_active IS TRUE LIMIT 1),
              (SELECT id FROM users WHERE user_is_active IS TRUE LIMIT 1));
      RAISE EXCEPTION 'A HOMES enrollment was accepted on a HEAR opportunity';
    EXCEPTION WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'A HOMES enrollment was accepted%' THEN RAISE; END IF;
      -- the guard fired, which is the expected outcome
    END;
  END IF;
END $$;
