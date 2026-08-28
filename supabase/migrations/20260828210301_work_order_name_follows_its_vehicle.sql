-- A work order's name is derived from its parent. The deriver only knew about
-- projects, so a fleet work order -- which has no project -- came out named
-- "Monthly Vehicle Equipment and Documents Check" with no way to tell which
-- truck it was for, and the name the opener supplied was overwritten.
--
-- The vehicle is the parent when there is no project, so it leads the name:
--   "Truck 02 — Bravo Crew - Monthly Vehicle Equipment and Documents Check"
--
-- This also fixes what a technician sees. LEAP Pad's Today list and work order
-- header fall back to work_order_name when there is no property, so before
-- this every fleet check on the list read identically.
--
-- Property work orders are untouched: a project name still wins wherever one
-- exists, so no existing name changes.
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
  v_vehicle_name   text;
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

  -- Fleet work: the vehicle is the parent, so it leads the name. Looked up
  -- only when there is no project, so a property work order is unaffected.
  IF NEW.project_id IS NULL AND NEW.vehicle_id IS NOT NULL THEN
    SELECT v.vehicle_name INTO v_vehicle_name
    FROM public.vehicles v WHERE v.id = NEW.vehicle_id;
  END IF;

  -- Always derived (NOT "only when blank"). work_order_name is read-only in the
  -- UI, so there is no user-entered value to preserve, and a name composed once
  -- could never follow its project.
  v_name := NULLIF(btrim(coalesce(v_project_name, v_vehicle_name, '')), '');
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

-- The behavioural proof runs against real vehicles in a rolled-back
-- transaction, not here: a probe insert cannot be undone inside a migration,
-- because block_hard_delete() forbids the cleanup (correctly). What IS asserted
-- here is that the deployed source carries the vehicle branch -- a silent
-- revert to the project-only version is the regression that matters.
DO $$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='work_order_inherit_parent_fields';
  IF v_src IS NULL OR v_src NOT LIKE '%v_vehicle_name%' THEN
    RAISE EXCEPTION 'work_order_inherit_parent_fields does not carry the vehicle branch — a fleet work order would lose its truck from its name.';
  END IF;
  IF v_src NOT LIKE '%coalesce(v_project_name, v_vehicle_name%' THEN
    RAISE EXCEPTION 'The project name must still win over the vehicle name, or property work orders would be renamed.';
  END IF;
END $$;
