-- Restore always-recompose on work order names.
--
-- Regression introduced earlier the same day. Migration 20260817160500
-- deliberately removed the "only when blank" guard from
-- work_order_inherit_parent_fields so a work order name could follow its project
-- ("Always derived (was: only when blank). work_order_name is read-only in the
-- UI, so there is no user-entered value to preserve — and a name composed once
-- could never follow its project"). Migration 20260817163750 then rewrote the
-- same function to add the assessment link, and was based on the OLDER
-- 20260817132200 body, which silently put the guard back.
--
-- Caught by the property backfill: PROP-23587 became "1837 Alden Road -
-- Janesville" and its building and opportunity followed, but its work orders
-- still read "1837 Alden Rd - Janesville" — the cascade fired and the guard threw
-- the recomposed name away.
--
-- This body is 20260817160500's always-recompose version PLUS the assessment
-- adoption from 20260817163750. Nothing else differs.
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

  -- Always derived (NOT "only when blank"). work_order_name is read-only in the
  -- UI, so there is no user-entered value to preserve, and a name composed once
  -- could never follow its project.
  v_name := NULLIF(btrim(coalesce(v_project_name, '')), '');
  v_name := public.append_name_segment(v_name, COALESCE(v_unit_number, v_unit_name));
  v_name := public.append_name_segment(v_name, COALESCE(v_work_type_name, v_record_type_lbl));
  IF v_name IS NOT NULL THEN
    NEW.work_order_name := v_name;
  END IF;

  -- Denormalized text mirrors follow their source too, for the same reason.
  NEW.work_order_project       := COALESCE(v_project_name, NEW.work_order_project);
  NEW.work_order_unit          := COALESCE(v_unit_number, v_unit_name, NEW.work_order_unit);
  NEW.work_order_property_name := COALESCE(v_property_name, NEW.work_order_property_name);
  NEW.work_order_property      := COALESCE(v_property_name, NEW.work_order_property);
  NEW.work_order_building      := COALESCE(v_building_name, NEW.work_order_building);

  RETURN NEW;
END;
$function$;

UPDATE public.work_orders
   SET work_order_name = work_order_name
 WHERE work_order_is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
