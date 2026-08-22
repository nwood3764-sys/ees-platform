-- Which assessment record types are available is decided by the OPPORTUNITY
-- record type.
--
-- Nicholas, 2026-08-22: "I shouldn't be able to select a Wisconsin assessment
-- type for a North Carolina property and vice versa... I think it's better if
-- it's on the opportunity record type. We select what assessment record types
-- are available."
--
-- record_type_eligibility is exactly that shape already — (parent_object,
-- parent_record_type, child_object, child_record_type), seeded 2026-08-13 for
-- work orders under projects. It was never extended to any other pair and has no
-- client consumer, so today it can only reject a bad combination at save time.
-- This migration makes it govern assessments under opportunities and gives the
-- UI something to read, so the wrong types never appear in the first place.
--
-- Semantics are unchanged and stay permissive: a (parent_object,
-- parent_record_type, child_object) triple with NO active edges is
-- UNCONSTRAINED. Only the programs seeded below become constrained; every other
-- opportunity record type keeps offering every assessment record type.
--
-- Four parts:
--   1. eligible_record_types_for_parent() — the resolver the picker reads.
--   2. derive_assessment_record_type()    — an assessment with no record type
--      takes its opportunity's program, instead of the global default.
--   3. enforce_assessment_record_type_eligibility() — the guardrail.
--   4. Seeds, Wisconsin state-scoping, and the ASMT-00025 repair.

-- ---------------------------------------------------------------------------
-- 1. Resolver. Returns the child record types allowed under a given parent
--    record type — or every active child record type when the triple carries no
--    edges. Shaped to match what fetchAvailableRecordTypes() already selects so
--    the client can swap one call for the other.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.eligible_record_types_for_parent(
  p_parent_object      text,
  p_parent_record_type uuid,
  p_child_object       text
) RETURNS TABLE (
  id                 uuid,
  picklist_value     text,
  picklist_label     text,
  picklist_state     text,
  picklist_sort_order integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT pv.id, pv.picklist_value, pv.picklist_label, pv.picklist_state, pv.picklist_sort_order
    FROM public.picklist_values pv
   WHERE pv.picklist_object = p_child_object
     AND pv.picklist_field  = 'record_type'
     AND pv.picklist_is_active
     AND (
       -- Unconstrained: no edges seeded for this parent record type.
       NOT EXISTS (
         SELECT 1 FROM public.record_type_eligibility e
          WHERE e.rte_parent_object      = p_parent_object
            AND e.rte_parent_record_type_id = p_parent_record_type
            AND e.rte_child_object       = p_child_object
            AND e.rte_is_active AND NOT e.rte_is_deleted
       )
       OR EXISTS (
         SELECT 1 FROM public.record_type_eligibility e
          WHERE e.rte_parent_object      = p_parent_object
            AND e.rte_parent_record_type_id = p_parent_record_type
            AND e.rte_child_object       = p_child_object
            AND e.rte_child_record_type_id = pv.id
            AND e.rte_is_active AND NOT e.rte_is_deleted
       )
     )
   ORDER BY pv.picklist_label;
$$;

REVOKE ALL ON FUNCTION public.eligible_record_types_for_parent(text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.eligible_record_types_for_parent(text, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. An assessment with no record type takes its OPPORTUNITY's program.
--
--    Root cause of ASMT-00025: enforce_rt__assessments falls back to
--    default_record_type_for('assessments'), which is a single global value with
--    no idea what state the record is in. On a North Carolina opportunity that
--    handed out the Wisconsin record type.
--
--    Resolution order: an eligible assessment record type whose value matches
--    the opportunity's record-type value exactly (the program's own type), then
--    the only eligible type if there is exactly one, then leave it null for
--    enforce_rt__assessments to fill as before.
--
--    The trigger is named trg_assessment_0_* deliberately: Postgres fires BEFORE
--    triggers in alphabetical order, and derive_assessment_name() reads
--    NEW.assessment_record_type to build the record's name. This has to land
--    before trg_assessment_name, or the name is composed from the wrong program.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_assessment_record_type()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_opp_rt    uuid;
  v_opp_value text;
  v_pick      uuid;
  v_count     integer;
BEGIN
  IF NEW.assessment_record_type IS NOT NULL OR NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.opportunity_record_type INTO v_opp_rt
    FROM public.opportunities o WHERE o.id = NEW.opportunity_id;
  IF v_opp_rt IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pv.picklist_value INTO v_opp_value
    FROM public.picklist_values pv WHERE pv.id = v_opp_rt;

  -- a. The program's own assessment record type, if it is eligible here.
  SELECT e.id INTO v_pick
    FROM public.eligible_record_types_for_parent('opportunities', v_opp_rt, 'assessments') e
   WHERE e.picklist_value = v_opp_value
   LIMIT 1;

  -- b. Otherwise, the only eligible type — if there is exactly one.
  IF v_pick IS NULL THEN
    SELECT count(*) INTO v_count
      FROM public.eligible_record_types_for_parent('opportunities', v_opp_rt, 'assessments');
    IF v_count = 1 THEN
      SELECT e.id INTO v_pick
        FROM public.eligible_record_types_for_parent('opportunities', v_opp_rt, 'assessments') e
       LIMIT 1;
    END IF;
  END IF;

  -- c. Ambiguous: leave null so enforce_rt__assessments applies the global
  --    default and the user is prompted in the UI, exactly as before.
  IF v_pick IS NOT NULL THEN
    NEW.assessment_record_type := v_pick;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.derive_assessment_record_type() FROM public, anon;

DROP TRIGGER IF EXISTS trg_assessment_0_record_type ON public.assessments;
CREATE TRIGGER trg_assessment_0_record_type
  BEFORE INSERT ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.derive_assessment_record_type();

-- ---------------------------------------------------------------------------
-- 3. Guardrail. Modeled on enforce_work_order_record_type_eligibility()
--    (20260813125255) — same permissive semantics, same descriptive error.
--    Named trg_zz_* so it runs after every other BEFORE trigger, including the
--    derivation above and enforce_rt__assessments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_assessment_record_type_eligibility()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_parent_rt    uuid;
  v_parent_label text;
  v_child_label  text;
  v_allowed      text;
BEGIN
  IF NEW.opportunity_id IS NULL OR NEW.assessment_record_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT opportunity_record_type INTO v_parent_rt
    FROM public.opportunities WHERE id = NEW.opportunity_id;
  IF v_parent_rt IS NULL THEN RETURN NEW; END IF;

  IF public.record_type_eligible('opportunities', v_parent_rt, 'assessments', NEW.assessment_record_type) THEN
    RETURN NEW;
  END IF;

  SELECT picklist_label INTO v_parent_label FROM public.picklist_values WHERE id = v_parent_rt;
  SELECT picklist_label INTO v_child_label  FROM public.picklist_values WHERE id = NEW.assessment_record_type;
  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.record_type_eligibility e
    JOIN public.picklist_values pv ON pv.id = e.rte_child_record_type_id
   WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = v_parent_rt
     AND e.rte_child_object = 'assessments' AND e.rte_is_active AND NOT e.rte_is_deleted;

  RAISE EXCEPTION
    'Assessment record type "%" is not allowed on a "%" opportunity. Allowed here: %.',
    COALESCE(v_child_label,'(unknown)'), COALESCE(v_parent_label,'(unknown)'),
    COALESCE(v_allowed,'(none configured)');
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_assessment_record_type_eligibility() FROM public, anon;

DROP TRIGGER IF EXISTS trg_zz_assessment_record_type_eligibility ON public.assessments;
CREATE TRIGGER trg_zz_assessment_record_type_eligibility
  BEFORE INSERT OR UPDATE OF assessment_record_type, opportunity_id ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assessment_record_type_eligibility();

-- ---------------------------------------------------------------------------
-- 4. Seeds, state-scoping and the repair.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_actor  uuid;
  v_edges  integer := 0;
  v_nc_rt  uuid;
  v_fixed  integer := 0;
BEGIN
  SELECT id INTO v_actor FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1;

  -- 4a. Wisconsin's own assessment record types were never state-scoped, so they
  --     showed on every property in the country. The NC and MI types created in
  --     20260822213141 already carry their state; this completes the set.
  UPDATE public.picklist_values
     SET picklist_state = 'WI'
   WHERE picklist_object = 'assessments'
     AND picklist_field  = 'record_type'
     AND picklist_value IN ('WI-IRA-MF-HOMES-AUDIT', 'WI-IRA-SF-HOMES-AUDIT')
     AND picklist_state IS DISTINCT FROM 'WI';
  -- ASHRAE Level 1 and Level 2 stay nationwide (picklist_state NULL) on purpose:
  -- they are not program types and are valid work in any state.

  -- 4b. One edge per program: an opportunity record type may carry the
  --     assessment record type of the same name, plus the two nationwide ASHRAE
  --     types. Nicholas, 2026-08-22: "For now, just do the ASHRAE ones, and I'll
  --     select them later" — the Setup pane makes this editable per program.
  INSERT INTO public.record_type_eligibility (
    rte_record_number, rte_parent_object, rte_parent_record_type_id,
    rte_child_object, rte_child_record_type_id, rte_created_by, rte_updated_by
  )
  SELECT '', 'opportunities', opp.id, 'assessments', asmt.id, v_actor, v_actor
    FROM public.picklist_values opp
    JOIN public.picklist_values asmt
      ON asmt.picklist_object = 'assessments'
     AND asmt.picklist_field  = 'record_type'
     AND asmt.picklist_is_active
     AND (
          asmt.picklist_value = opp.picklist_value                    -- the program's own type
       OR asmt.picklist_value IN ('ASHRAE-LEVEL-1', 'ASHRAE-LEVEL-2') -- nationwide generics
     )
   WHERE opp.picklist_object = 'opportunities'
     AND opp.picklist_field  = 'record_type'
     AND opp.picklist_is_active
     -- Only constrain programs that actually have their own assessment type.
     -- Everything else stays unconstrained, exactly as before this migration.
     AND EXISTS (
       SELECT 1 FROM public.picklist_values m
        WHERE m.picklist_object = 'assessments' AND m.picklist_field = 'record_type'
          AND m.picklist_is_active AND m.picklist_value = opp.picklist_value
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.record_type_eligibility e
        WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = opp.id
          AND e.rte_child_object = 'assessments' AND e.rte_child_record_type_id = asmt.id
          AND NOT e.rte_is_deleted
     );
  GET DIAGNOSTICS v_edges = ROW_COUNT;

  -- 4c. Repair ASMT-00025 — created on a North Carolina opportunity before NC
  --     had a record type, so it carried Wisconsin's and its name doubled the
  --     program suffix. The UPDATE re-fires derive_assessment_name(), whose
  --     append_name_segment() collapses the now-matching segments.
  SELECT id INTO v_nc_rt
    FROM public.picklist_values
   WHERE picklist_object = 'assessments' AND picklist_field = 'record_type'
     AND picklist_value = 'NC-IRA-MF-HOMES-AUDIT' AND picklist_is_active
   LIMIT 1;

  IF v_nc_rt IS NOT NULL THEN
    UPDATE public.assessments a
       SET assessment_record_type = v_nc_rt
      FROM public.opportunities o
      JOIN public.picklist_values ort ON ort.id = o.opportunity_record_type
     WHERE a.opportunity_id = o.id
       AND ort.picklist_value = 'NC-IRA-MF-HOMES-AUDIT'
       AND a.assessment_record_type IS DISTINCT FROM v_nc_rt;
    GET DIAGNOSTICS v_fixed = ROW_COUNT;
  END IF;

  RAISE NOTICE 'Seeded % eligibility edge(s); repointed % assessment(s).', v_edges, v_fixed;
END $do$;

NOTIFY pgrst, 'reload schema';
