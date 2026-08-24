-- A Wisconsin program cannot sit on a North Carolina property. Not "is not
-- offered" — cannot exist.
--
-- Nicholas, 2026-08-24: "It should be impossible to have a Wisconsin opportunity
-- record type on North Carolina property. Need to switch them."
--
-- The state rule shipped on 2026-08-23 (20260823002712) deliberately
-- grandfathered the rows that predated it: the trigger returned early whenever
-- an UPDATE left both the record type and the property alone, so the five
-- FOE-2024-WI opportunities on Huntersville, North Carolina properties stayed
-- editable while their real program was decided. That decision is now made, so
-- the exemption has nothing left to protect — and an exemption that outlives its
-- data is just a hole. This migration closes all three ways the state could be
-- wrong: the rows that are wrong today, the exemption that let them stay wrong,
-- and the one path that could still create a new mismatch.
--
-- Same treatment for incentive applications (20260823202021), whose identical
-- grandfather clause was written yesterday and never had a row to protect —
-- verified zero cross-state applications and zero cross-state assessments before
-- removing it.

-- ---------------------------------------------------------------------------
-- 1. Switch the five.
--
--    What they are, from the data rather than from their names: five
--    opportunities on two single-unit (property_total_units = 1) Huntersville NC
--    properties, each carrying exactly one project whose record type is
--    SINGLE-FAMILY-ENERGY-ASSESSMENT, one work order apiece, no assessments, no
--    applications, no service appointments, no stage. They are single-family
--    energy assessments, created by the public scheduler, which stamped the
--    platform default record type — FOE-2024-WI, a Wisconsin program — because
--    at the time the default was state-specific.
--
--    So the target is not a guess: an assessment is the AUDIT program's own
--    work (the ruling behind retiring the generic assessment opportunity record
--    types in 20260823002913), single-family, in North Carolina —
--    NC-IRA-SF-HOMES-AUDIT.
--
--    Run with triggers ENABLED, unlike the backfills of the last two days. Every
--    one of them is wanted here: derive_opportunity_name() recomposes the name
--    off the new record type (and cascades it to the projects, which carry the
--    program in their names too), set_opportunity_price_book_from_record_type()
--    repoints the price book, and the audit log records a real change of program
--    on five live records — which is exactly what this is.
--
--    opportunity_stage is left NULL. It was NULL under FOE-2024-WI as well;
--    every record type owns its own stage picklist, and which stage an
--    already-scheduled assessment belongs in is a business call, not a migration's.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_target uuid;
  v_n      integer;
BEGIN
  SELECT id INTO v_target
    FROM public.picklist_values
   WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type'
     AND picklist_value = 'NC-IRA-SF-HOMES-AUDIT' AND picklist_is_active
   LIMIT 1;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'NC-IRA-SF-HOMES-AUDIT not found — refusing to move opportunities to a record type that does not exist.';
  END IF;

  -- Matched on the mismatch itself, not on a list of record numbers: whatever
  -- is provably a Wisconsin program on a North Carolina single-family property
  -- is what moves. Restricted to the shape verified above so this cannot quietly
  -- sweep up a multifamily or non-assessment opportunity if one appears between
  -- authoring and replay.
  UPDATE public.opportunities o
     SET opportunity_record_type = v_target
    FROM public.properties p, public.picklist_values rt
   WHERE p.id = o.property_id
     AND rt.id = o.opportunity_record_type
     AND o.opportunity_is_deleted IS NOT TRUE
     AND rt.picklist_state = 'WI'
     AND p.property_state  = 'NC'
     AND COALESCE(p.property_total_units, 1) = 1
     AND EXISTS (
       SELECT 1 FROM public.projects pr
        JOIN public.picklist_values prt ON prt.id = pr.project_record_type
       WHERE pr.opportunity_id = o.id AND pr.project_is_deleted IS NOT TRUE
         AND prt.picklist_value = 'SINGLE-FAMILY-ENERGY-ASSESSMENT'
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Moved % opportunity(ies) to NC-IRA-SF-HOMES-AUDIT.', v_n;

  -- Nothing may be left over. If a cross-state opportunity survives this, the
  -- exemption removed below would make it uneditable, so fail loudly here
  -- instead of shipping a record nobody can touch.
  SELECT count(*) INTO v_n
    FROM public.opportunities o
    JOIN public.properties p ON p.id = o.property_id
    JOIN public.picklist_values rt ON rt.id = o.opportunity_record_type
   WHERE o.opportunity_is_deleted IS NOT TRUE
     AND rt.picklist_state IS NOT NULL AND p.property_state IS NOT NULL
     AND rt.picklist_state <> p.property_state;

  IF v_n > 0 THEN
    RAISE EXCEPTION
      '% opportunity(ies) still carry a record type from another state — refusing to remove the grandfather clause while a record would be left uneditable.', v_n;
  END IF;
END $do$;

-- ---------------------------------------------------------------------------
-- 2. Remove the grandfather clause from the opportunity rule.
--
--    Byte-identical to 20260823002712 apart from the deleted early-return: same
--    permissive treatment of a nationwide record type and of a property with no
--    state, same message. What changes is that a row already in violation can no
--    longer be saved at all — which is the point. There are none as of part 1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_opportunity_record_type_state()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_state    text;
  v_rt_state text;
  v_rt_label text;
  v_allowed  text;
BEGIN
  IF NEW.opportunity_record_type IS NULL OR NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT property_state INTO v_state FROM public.properties WHERE id = NEW.property_id;
  IF v_state IS NULL THEN RETURN NEW; END IF;

  SELECT picklist_state, picklist_label INTO v_rt_state, v_rt_label
    FROM public.picklist_values WHERE id = NEW.opportunity_record_type;

  IF v_rt_state IS NULL OR v_rt_state = v_state THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.picklist_values pv
   WHERE pv.picklist_object = 'opportunities' AND pv.picklist_field = 'record_type'
     AND pv.picklist_is_active
     AND (pv.picklist_state IS NULL OR pv.picklist_state = v_state);

  RAISE EXCEPTION
    'Opportunity record type "%" runs in % and this property is in %. Available in %: %.',
    COALESCE(v_rt_label, '(unknown)'), v_rt_state, v_state, v_state,
    COALESCE(v_allowed, '(none configured)');
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_opportunity_record_type_state() FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The remaining way in: the PROPERTY moves.
--
--    The rules above all fire on the child record. Nothing fired when the
--    property itself changed state, and cascade_property_state_to_opportunities
--    only carried opportunity_state across — so correcting a property from WI to
--    NC silently left every Wisconsin program on it stranded in North Carolina,
--    reintroducing exactly the state this migration exists to end.
--
--    A property cannot be moved out from under its records. There is no
--    automatic answer for what those records become — FOE-2024-WI has no North
--    Carolina counterpart, which is why part 1 needed the shape of the data to
--    decide — so the change is refused and the blocking records are named. Move
--    them first, then move the property.
--
--    All three objects that carry state-scoped record types are checked
--    together. Add an object to this UNION when it gains them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_property_state_change_against_program_records()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_blocking text;
  v_count    integer;
BEGIN
  IF NEW.property_state IS NOT DISTINCT FROM OLD.property_state
     OR NEW.property_state IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*), string_agg(rec || ' (' || label || ', ' || rt_state || ')', ', ' ORDER BY rec)
    INTO v_count, v_blocking
  FROM (
    SELECT o.opportunity_record_number AS rec, rt.picklist_label AS label, rt.picklist_state AS rt_state
      FROM public.opportunities o
      JOIN public.picklist_values rt ON rt.id = o.opportunity_record_type
     WHERE o.property_id = NEW.id AND o.opportunity_is_deleted IS NOT TRUE
       AND rt.picklist_state IS NOT NULL AND rt.picklist_state <> NEW.property_state
    UNION ALL
    SELECT ia.ia_record_number, rt.picklist_label, rt.picklist_state
      FROM public.incentive_applications ia
      JOIN public.picklist_values rt ON rt.id = ia.ia_record_type
     WHERE ia.property_id = NEW.id AND ia.ia_is_deleted IS NOT TRUE
       AND rt.picklist_state IS NOT NULL AND rt.picklist_state <> NEW.property_state
    UNION ALL
    SELECT a.assessment_record_number, rt.picklist_label, rt.picklist_state
      FROM public.assessments a
      JOIN public.picklist_values rt ON rt.id = a.assessment_record_type
     WHERE a.property_id = NEW.id AND a.assessment_is_deleted IS NOT TRUE
       AND rt.picklist_state IS NOT NULL AND rt.picklist_state <> NEW.property_state
  ) blocking;

  IF COALESCE(v_count, 0) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'This property cannot move from % to % while % record(s) on it run another state''s programs: %. Change those records to a % program first.',
    COALESCE(OLD.property_state, '(none)'), NEW.property_state, v_count, v_blocking, NEW.property_state;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_property_state_change_against_program_records() FROM public, anon, authenticated;

-- BEFORE, so it refuses ahead of the AFTER cascade that would carry the new
-- state down to the opportunities.
DROP TRIGGER IF EXISTS trg_zz_property_state_change_guard ON public.properties;
CREATE TRIGGER trg_zz_property_state_change_guard
  BEFORE UPDATE OF property_state ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.enforce_property_state_change_against_program_records();

-- ---------------------------------------------------------------------------
-- 4. The same exemption, removed from the incentive application rule.
--
--    Written yesterday in 20260823202021 for symmetry with the opportunity rule;
--    it never had a row to protect (verified: zero cross-state applications,
--    zero cross-state assessments) and would have quietly permitted the first
--    one. Byte-identical to that definition apart from the deleted early-return.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_incentive_application_record_type()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_state      text;
  v_rt_state   text;
  v_rt_label   text;
  v_parent_rt  uuid;
  v_opp_label  text;
  v_allowed    text;
BEGIN
  IF NEW.ia_record_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT picklist_state, picklist_label INTO v_rt_state, v_rt_label
    FROM public.picklist_values WHERE id = NEW.ia_record_type;

  IF NEW.property_id IS NOT NULL AND v_rt_state IS NOT NULL THEN
    SELECT property_state INTO v_state FROM public.properties WHERE id = NEW.property_id;

    IF v_state IS NOT NULL AND v_state <> v_rt_state THEN
      SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
        INTO v_allowed
        FROM public.picklist_values pv
       WHERE pv.picklist_object = 'incentive_applications'
         AND pv.picklist_field  = 'record_type'
         AND pv.picklist_is_active
         AND (pv.picklist_state IS NULL OR pv.picklist_state = v_state);

      RAISE EXCEPTION
        'Incentive application record type "%" runs in % and this property is in %. Available in %: %.',
        COALESCE(v_rt_label, '(unknown)'), v_rt_state, v_state, v_state,
        COALESCE(v_allowed, '(none configured)');
    END IF;
  END IF;

  IF NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT opportunity_record_type INTO v_parent_rt
    FROM public.opportunities WHERE id = NEW.opportunity_id;
  IF v_parent_rt IS NULL THEN RETURN NEW; END IF;

  IF public.record_type_eligible(
       'opportunities', v_parent_rt, 'incentive_applications', NEW.ia_record_type) THEN
    RETURN NEW;
  END IF;

  SELECT picklist_label INTO v_opp_label FROM public.picklist_values WHERE id = v_parent_rt;
  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.record_type_eligibility e
    JOIN public.picklist_values pv ON pv.id = e.rte_child_record_type_id
   WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = v_parent_rt
     AND e.rte_child_object = 'incentive_applications'
     AND e.rte_is_active AND NOT e.rte_is_deleted;

  RAISE EXCEPTION
    'Incentive application record type "%" is not part of the "%" program. Allowed here: %.',
    COALESCE(v_rt_label, '(unknown)'), COALESCE(v_opp_label, '(unknown)'),
    COALESCE(v_allowed, '(none configured)');
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_incentive_application_record_type() FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
