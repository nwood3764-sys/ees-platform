-- Every assessment lives on a project, and its work orders inherit it.
--
-- Nicholas, 2026-08-16: "an assessment work order doesn't really need a
-- project, but if it does, we'll probably need to build that project record
-- type. They keep it in line with everything else and organize the same. Work
-- orders are always on projects. That's fine."
--
-- work_orders.project_id is NOT NULL, so a work order genuinely cannot exist
-- without a project. assessments.project_id has existed all along and was never
-- populated — 0 of 13 live assessments carry one — and 12 of those 13
-- assessments hang off an opportunity that has no project either. So creating a
-- work order from an assessment dead-ended: the create pop-up asked for a
-- Project, the client's fallback (most recent live project on the opportunity,
-- PR #476) found nothing, and there was nothing to pick.
--
-- The fix is structural, not a prefill: an assessment resolves its project, and
-- creates one on its opportunity if that opportunity has none. Then the work
-- order inherits project_id the ordinary way, from a column its parent holds.
--
-- Record type for a created project is resolved from configuration, never
-- hardcoded to one program:
--   1. the projects record type whose picklist_value equals the ASSESSMENT's
--      record-type value — WI-IRA-MF-HOMES-AUDIT, ASHRAE-LEVEL-1 and friends
--      exist on both objects, so a program that has its own assessment project
--      record type gets it;
--   2. otherwise the purpose-built 'ASSESSMENT' projects record type, which is
--      exactly what it is named for.
-- Status comes from picklist_values_for_record_type so a record type with its
-- own scoped project_status set gets its own first value.

CREATE OR REPLACE FUNCTION public.derive_assessment_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor    uuid;
  v_rt_value text;
  v_proj_rt  uuid;
  v_status   uuid;
  v_account  uuid;
  v_new      uuid;
BEGIN
  IF NEW.project_id IS NOT NULL OR NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. A project already on this assessment's opportunity. Prefer one on the
  --    same building — an opportunity can carry several — then the newest.
  SELECT p.id INTO NEW.project_id
    FROM public.projects p
   WHERE p.opportunity_id = NEW.opportunity_id
     AND p.project_is_deleted IS NOT TRUE
   ORDER BY (p.building_id IS NOT DISTINCT FROM NEW.building_id) DESC,
            p.project_created_at DESC
   LIMIT 1;
  IF NEW.project_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2. No project on the opportunity yet, so the assessment's work needs one.
  v_actor := COALESCE(public.current_app_user_id(), NEW.assessment_owner, NEW.assessment_created_by);
  IF v_actor IS NULL THEN
    RETURN NEW;  -- nothing to own it; leave the field for the user rather than fail the insert
  END IF;

  SELECT pv.picklist_value INTO v_rt_value
    FROM public.picklist_values pv WHERE pv.id = NEW.assessment_record_type;

  SELECT pv.id INTO v_proj_rt
    FROM public.picklist_values pv
   WHERE pv.picklist_object = 'projects' AND pv.picklist_field = 'record_type'
     AND pv.picklist_is_active
     AND pv.picklist_value = v_rt_value
   LIMIT 1;
  IF v_proj_rt IS NULL THEN
    SELECT pv.id INTO v_proj_rt
      FROM public.picklist_values pv
     WHERE pv.picklist_object = 'projects' AND pv.picklist_field = 'record_type'
       AND pv.picklist_is_active AND pv.picklist_value = 'ASSESSMENT'
     LIMIT 1;
  END IF;
  IF v_proj_rt IS NULL THEN
    v_proj_rt := public.default_record_type_for('projects');
  END IF;

  SELECT s.id INTO v_status
    FROM public.picklist_values_for_record_type('projects', 'project_status', v_proj_rt) s
   ORDER BY s.picklist_sort_order NULLS LAST, s.picklist_label
   LIMIT 1;

  SELECT pr.property_account_id INTO v_account
    FROM public.properties pr WHERE pr.id = NEW.property_id;

  INSERT INTO public.projects (
    project_record_number, project_name, project_owner, project_created_by,
    opportunity_id, property_id, building_id, project_account_id,
    project_record_type, project_status, project_description
  ) VALUES (
    '', '', v_actor, v_actor,
    NEW.opportunity_id, NEW.property_id, NEW.building_id, v_account,
    v_proj_rt, v_status,
    'Created automatically to hold the work for this assessment.'
  ) RETURNING id INTO v_new;

  NEW.project_id := v_new;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.derive_assessment_project() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.derive_assessment_project() FROM anon;
REVOKE ALL ON FUNCTION public.derive_assessment_project() FROM authenticated;

-- Runs before the name trigger; neither depends on the other.
DROP TRIGGER IF EXISTS trg_assessment_project ON public.assessments;
CREATE TRIGGER trg_assessment_project
  BEFORE INSERT OR UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.derive_assessment_project();


-- A work order adopts the assessment its project belongs to.
--
-- Creating the work order FROM the assessment already prefills assessment_id
-- (the related list's own FK). This covers every other route in — from the
-- project, from LEAP Pad, from a list view — so the assessment's Work Orders
-- related list is not empty just because the technician started somewhere else.
--
-- Only when the answer is unambiguous: exactly one live assessment on that
-- project. Two assessments on one project means guessing, so it stays null.
CREATE OR REPLACE FUNCTION public.work_order_inherit_parent_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_project_name   text;
  v_proj_opp       uuid;
  v_proj_property  uuid;
  v_proj_building  uuid;
  v_unit_number    text;
  v_unit_name      text;
  v_work_type_name text;
  v_record_type_lbl text;
  v_property_name  text;
  v_building_name  text;
  v_name           text;
  v_assessments    uuid[];
BEGIN
  SELECT p.project_name, p.opportunity_id, p.property_id, p.building_id
    INTO v_project_name, v_proj_opp, v_proj_property, v_proj_building
  FROM public.projects p
  WHERE p.id = NEW.project_id;

  IF NEW.opportunity_id IS NULL THEN NEW.opportunity_id := v_proj_opp; END IF;
  IF NEW.property_id   IS NULL THEN NEW.property_id   := v_proj_property; END IF;
  IF NEW.building_id   IS NULL THEN NEW.building_id   := v_proj_building; END IF;

  -- The assessment this project's work belongs to, when there is exactly one.
  IF NEW.assessment_id IS NULL AND NEW.project_id IS NOT NULL THEN
    SELECT array_agg(a.id) INTO v_assessments
      FROM public.assessments a
     WHERE a.project_id = NEW.project_id
       AND a.assessment_is_deleted IS NOT TRUE;
    IF array_length(v_assessments, 1) = 1 THEN
      NEW.assessment_id := v_assessments[1];
    END IF;
  END IF;

  IF NEW.unit_id IS NOT NULL THEN
    SELECT u.unit_number, u.unit_name
      INTO v_unit_number, v_unit_name
    FROM public.units u WHERE u.id = NEW.unit_id;
  END IF;

  IF NEW.work_type_id IS NOT NULL THEN
    SELECT wt.work_type_name INTO v_work_type_name
    FROM public.work_types wt WHERE wt.id = NEW.work_type_id;
  END IF;

  IF NEW.work_order_record_type IS NOT NULL THEN
    SELECT pv.picklist_label INTO v_record_type_lbl
    FROM public.picklist_values pv WHERE pv.id = NEW.work_order_record_type;
  END IF;

  IF NEW.property_id IS NOT NULL THEN
    SELECT pr.property_name INTO v_property_name
    FROM public.properties pr WHERE pr.id = NEW.property_id;
  END IF;
  IF NEW.building_id IS NOT NULL THEN
    SELECT b.building_name INTO v_building_name
    FROM public.buildings b WHERE b.id = NEW.building_id;
  END IF;

  IF NEW.work_order_name IS NULL OR btrim(NEW.work_order_name) = '' THEN
    v_name := NULLIF(btrim(coalesce(v_project_name, '')), '');
    v_name := public.append_name_segment(v_name, COALESCE(v_unit_number, v_unit_name));
    v_name := public.append_name_segment(v_name, COALESCE(v_work_type_name, v_record_type_lbl));
    IF v_name IS NOT NULL THEN
      NEW.work_order_name := v_name;
    END IF;
  END IF;

  IF NEW.work_order_project IS NULL THEN NEW.work_order_project := v_project_name; END IF;
  IF NEW.work_order_unit IS NULL THEN NEW.work_order_unit := COALESCE(v_unit_number, v_unit_name); END IF;
  IF NEW.work_order_property_name IS NULL THEN NEW.work_order_property_name := v_property_name; END IF;
  IF NEW.work_order_property IS NULL THEN NEW.work_order_property := v_property_name; END IF;
  IF NEW.work_order_building IS NULL THEN NEW.work_order_building := v_building_name; END IF;

  RETURN NEW;
END;
$function$;

-- Backfill: touch every live assessment so it resolves or creates its project,
-- and re-derives its name off the current parent chain at the same time (the
-- name triggers only fire on write, so rows created before them still carry
-- their insert-time text — including doubled record-type labels and the
-- pre-normalization ALL-CAPS street/city).
UPDATE public.assessments
   SET assessment_updated_at = now()
 WHERE assessment_is_deleted IS NOT TRUE;

-- Then link existing work orders back to the single assessment on their project.
UPDATE public.work_orders w
   SET assessment_id = a.id
  FROM public.assessments a
 WHERE w.assessment_id IS NULL
   AND w.work_order_is_deleted IS NOT TRUE
   AND a.project_id = w.project_id
   AND a.assessment_is_deleted IS NOT TRUE
   AND (SELECT count(*) FROM public.assessments a2
         WHERE a2.project_id = w.project_id
           AND a2.assessment_is_deleted IS NOT TRUE) = 1;

NOTIFY pgrst, 'reload schema';
