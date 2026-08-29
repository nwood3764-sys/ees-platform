-- =============================================================================
-- One opportunity per building per record type.
--
-- Nicholas, 2026-08-27, from OPP-00154: "there's a duplicate opportunity on
-- this. We can't really have two opportunities of the same record type on a
-- building, which is not possible."
--
-- It was possible, and it happened: 5513 North Hopkins Street - Milwaukee -
-- 5513 carried OPP-00153 and OPP-00154, both WI-IRA-MF-HOMES, both live, both
-- at the Energy Modeling stage. A program runs on a building once; a second
-- record of the same program on the same building is not a second piece of
-- work, it is a copy of the first one — and the two then disagree about the
-- stage, carry different projects, and get worked separately.
--
-- The rule is enforced HERE, in the database, because the create pop-up is not
-- the only way an opportunity is born: five RPCs create them too (the public
-- scheduler, the NC HOMES intake form, the two LEAP Pad assessment paths, the
-- technician ad hoc work-order path). A rule that lives in the create form is
-- a rule that four of those six paths do not have.
--
-- Scoped to the BUILDING, which is where the work happens. A property with
-- eight buildings legitimately runs the same program on each of them, so the
-- property is the wrong key; an opportunity with no building at all is not
-- constrained (there are none today — all 103 live opportunities carry one).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_one_opportunity_per_building_record_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_number text;
  v_existing_stage  text;
  v_rt_label        text;
  v_building_name   text;
BEGIN
  -- Deleting is always allowed: putting a duplicate in the recycle bin is the
  -- REMEDY for this rule, and must never be blocked by it.
  IF NEW.opportunity_is_deleted IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.building_id IS NULL OR NEW.opportunity_record_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only a change that MOVES the record into a conflict is checked
  -- — a change of building, a change of program, or a restore out of the
  -- recycle bin. Editing any other field on a record that already sits in a
  -- pre-existing duplicate pair stays possible, so this rule can never make a
  -- live record uneditable (two such pairs exist today, on 15004 and 15008
  -- Statesville Road; both are real work awaiting a decision about which
  -- survives, and neither is this migration's to resolve).
  IF TG_OP = 'UPDATE'
     AND NEW.building_id IS NOT DISTINCT FROM OLD.building_id
     AND NEW.opportunity_record_type IS NOT DISTINCT FROM OLD.opportunity_record_type
     AND OLD.opportunity_is_deleted IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT o.opportunity_record_number,
         (SELECT pv.picklist_label FROM public.picklist_values pv WHERE pv.id = o.opportunity_stage)
    INTO v_existing_number, v_existing_stage
    FROM public.opportunities o
   WHERE o.building_id = NEW.building_id
     AND o.opportunity_record_type = NEW.opportunity_record_type
     AND o.opportunity_is_deleted IS NOT TRUE
     AND o.id IS DISTINCT FROM NEW.id
   ORDER BY o.opportunity_created_at
   LIMIT 1;

  IF v_existing_number IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT picklist_label INTO v_rt_label
    FROM public.picklist_values WHERE id = NEW.opportunity_record_type;
  SELECT building_name INTO v_building_name
    FROM public.buildings WHERE id = NEW.building_id;

  RAISE EXCEPTION
    'This building already has a "%" opportunity: % (%). A building runs each program once — open % instead of creating a second one, or delete it first if it is the duplicate.',
    COALESCE(v_rt_label, '(unnamed record type)'),
    v_existing_number,
    COALESCE(v_existing_stage, 'no stage set'),
    v_existing_number
    USING ERRCODE = '23505',
          HINT = format('Building: %s', COALESCE(v_building_name, '(unnamed)'));
END;
$function$;

-- SECURITY DEFINER so the check sees EVERY sibling opportunity on the
-- building. Under a state-restricted user (user_state_scopes) an invoker-side
-- read could miss a sibling it is not allowed to see and wave the duplicate
-- through — a rule that fails open is not a rule. EXECUTE is revoked because
-- firing a trigger needs no privilege on its function; nothing may call this
-- directly.
REVOKE EXECUTE ON FUNCTION public.enforce_one_opportunity_per_building_record_type() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_one_opportunity_per_building_record_type() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_one_opportunity_per_building_record_type() FROM authenticated;

-- trg_zz_ so it sorts AFTER the triggers that derive what it inspects:
-- trg_enforce_record_type stamps the platform default record type when the
-- insert supplies none (which is exactly what the public scheduler does), and
-- trg_0_* resolve the parents. Checking before those run would read a NULL
-- record type and pass everything.
DROP TRIGGER IF EXISTS trg_zz_opportunity_one_per_building_record_type ON public.opportunities;
CREATE TRIGGER trg_zz_opportunity_one_per_building_record_type
  BEFORE INSERT OR UPDATE OF building_id, opportunity_record_type, opportunity_is_deleted
  ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_one_opportunity_per_building_record_type();
