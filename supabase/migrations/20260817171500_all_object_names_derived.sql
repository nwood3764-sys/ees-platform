-- Every object's name is derived. No path can hardcode one.
--
-- Nicholas, 2026-08-17: "All the objects should be concatenated and follow the
-- correct naming schema… No one should be able to hard code any of that."
--
-- Nine objects already composed their name in a BEFORE trigger (properties,
-- buildings, units, opportunities, projects, work orders, incentive
-- applications, contacts, opportunity contact roles). Six did not — their names
-- were assembled in application code or an RPC at create time and then frozen:
--
--   work_plans                      copied from its work plan template
--   work_steps                      copied from its work step template
--   service_appointments            composed in the create-WO RPCs
--   service_appointment_assignments composed in the create-WO RPCs
--   assessments                     composed in the create form (client-side)
--   users                           typed, or first/last entered separately
--
-- Each schema below is taken from the live data, not invented, so no existing
-- name changes shape:
--
--   work_plans                      = <work plan template name>
--   work_steps                      = <work step template name>
--   service_appointments            = <work type> - <property> [- <unit>]
--   service_appointment_assignments = <user> — <service appointment>
--   assessments                     = <opportunity/building/property> - <record type>
--   users                           = <first> <last>
--
-- With these, every named object in the platform reads its name from its related
-- records on every write. Application code can still pass a name; the trigger
-- overwrites it with the derived value, which is what makes hardcoding
-- impossible rather than merely discouraged.

-- ── work_plans = its template's name ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derive_work_plan_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_template text;
BEGIN
  SELECT wpt.wpt_name INTO v_template
    FROM public.work_plan_templates wpt WHERE wpt.id = NEW.work_plan_template_id;
  NEW.work_plan_name := COALESCE(
    NULLIF(btrim(coalesce(v_template, '')), ''),
    NULLIF(btrim(coalesce(NEW.work_plan_name, '')), ''),
    NEW.work_plan_name);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_work_plan_name ON public.work_plans;
CREATE TRIGGER trg_work_plan_name
  BEFORE INSERT OR UPDATE ON public.work_plans
  FOR EACH ROW EXECUTE FUNCTION public.derive_work_plan_name();

-- ── work_steps = its template's name ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derive_work_step_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_template text;
BEGIN
  SELECT wst.wst_name INTO v_template
    FROM public.work_step_templates wst WHERE wst.id = NEW.work_step_template_id;
  NEW.work_step_name := COALESCE(
    NULLIF(btrim(coalesce(v_template, '')), ''),
    NULLIF(btrim(coalesce(NEW.work_step_name, '')), ''),
    NEW.work_step_name);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_work_step_name ON public.work_steps;
CREATE TRIGGER trg_work_step_name
  BEFORE INSERT OR UPDATE ON public.work_steps
  FOR EACH ROW EXECUTE FUNCTION public.derive_work_step_name();

-- ── service_appointments = <work type> - <property> [- <unit>] ─────────────
-- Property and unit come through the work order, which is the only place a
-- service appointment holds them.
CREATE OR REPLACE FUNCTION public.derive_service_appointment_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_work_type text;
  v_property  text;
  v_unit      text;
  v_name      text;
BEGIN
  SELECT wt.work_type_name INTO v_work_type
    FROM public.work_types wt WHERE wt.id = NEW.work_type_id;

  SELECT pr.property_name, u.unit_number
    INTO v_property, v_unit
    FROM public.work_orders wo
    LEFT JOIN public.properties pr ON pr.id = wo.property_id
    LEFT JOIN public.units u       ON u.id  = wo.unit_id
   WHERE wo.id = NEW.work_order_id;

  v_name := NULLIF(btrim(coalesce(v_work_type, '')), '');
  v_name := public.append_name_segment(v_name, v_property);
  v_name := public.append_name_segment(v_name, v_unit);

  NEW.sa_name := COALESCE(v_name, NULLIF(btrim(coalesce(NEW.sa_name, '')), ''), NEW.sa_name);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sa_name ON public.service_appointments;
CREATE TRIGGER trg_sa_name
  BEFORE INSERT OR UPDATE ON public.service_appointments
  FOR EACH ROW EXECUTE FUNCTION public.derive_service_appointment_name();

-- ── service_appointment_assignments = <user> — <service appointment> ───────
-- Em dash between the person and the work, per the live data.
CREATE OR REPLACE FUNCTION public.derive_saa_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user text;
  v_sa   text;
  v_name text;
BEGIN
  SELECT u.user_name INTO v_user FROM public.users u WHERE u.id = NEW.saa_user_id;
  SELECT sa.sa_name INTO v_sa
    FROM public.service_appointments sa WHERE sa.id = NEW.service_appointment_id;

  v_name := NULLIF(btrim(concat_ws(' — ',
              NULLIF(btrim(coalesce(v_user, '')), ''),
              NULLIF(btrim(coalesce(v_sa, '')), ''))), '');

  NEW.saa_name := COALESCE(v_name, NULLIF(btrim(coalesce(NEW.saa_name, '')), ''), NEW.saa_name);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_saa_name ON public.service_appointment_assignments;
CREATE TRIGGER trg_saa_name
  BEFORE INSERT OR UPDATE ON public.service_appointment_assignments
  FOR EACH ROW EXECUTE FUNCTION public.derive_saa_name();

-- ── assessments = <opportunity/building/property> - <record type> ──────────
-- Same shape as incentive_applications: the richest parent available, then the
-- record type. Replaces the client-side composition, which froze at create.
CREATE OR REPLACE FUNCTION public.derive_assessment_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_base text;
  v_rt   text;
  v_name text;
BEGIN
  SELECT pv.picklist_label INTO v_rt
    FROM public.picklist_values pv WHERE pv.id = NEW.assessment_record_type;

  SELECT coalesce(o.opportunity_name, b.building_name, p.property_name)
    INTO v_base
    FROM (SELECT 1) z
    LEFT JOIN public.opportunities o ON o.id = NEW.opportunity_id
    LEFT JOIN public.buildings     b ON b.id = NEW.building_id
    LEFT JOIN public.properties    p ON p.id = NEW.property_id;

  v_name := public.append_name_segment(
              NULLIF(btrim(coalesce(v_base, '')), ''),
              NULLIF(btrim(coalesce(v_rt, '')), ''));

  NEW.assessment_name := COALESCE(
    v_name, NULLIF(btrim(coalesce(NEW.assessment_name, '')), ''), NEW.assessment_name);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assessment_name ON public.assessments;
CREATE TRIGGER trg_assessment_name
  BEFORE INSERT OR UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.derive_assessment_name();

-- ── users = <first> <last> ────────────────────────────────────────────────
-- Same rule contacts already follow (trg_contact_name).
CREATE OR REPLACE FUNCTION public.derive_user_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_name text;
BEGIN
  v_name := NULLIF(btrim(concat_ws(' ',
              NULLIF(btrim(coalesce(NEW.user_first_name, '')), ''),
              NULLIF(btrim(coalesce(NEW.user_last_name, '')), ''))), '');
  NEW.user_name := COALESCE(v_name, NULLIF(btrim(coalesce(NEW.user_name, '')), ''), NEW.user_name);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_user_name ON public.users;
CREATE TRIGGER trg_user_name
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.derive_user_name();

-- ── Cascades for the new edges ────────────────────────────────────────────
-- Same generic cascade_derived_name() as the property chain.
DROP TRIGGER IF EXISTS trg_cascade_wpt_name_to_work_plans ON public.work_plan_templates;
CREATE TRIGGER trg_cascade_wpt_name_to_work_plans
  AFTER UPDATE ON public.work_plan_templates FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'wpt_name', 'work_plans', 'work_plan_template_id', 'work_plan_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_wst_name_to_work_steps ON public.work_step_templates;
CREATE TRIGGER trg_cascade_wst_name_to_work_steps
  AFTER UPDATE ON public.work_step_templates FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'wst_name', 'work_steps', 'work_step_template_id', 'work_step_is_deleted');

-- A work type rename reaches both the work orders and the appointments naming
-- themselves after it.
DROP TRIGGER IF EXISTS trg_cascade_work_type_to_work_orders ON public.work_types;
CREATE TRIGGER trg_cascade_work_type_to_work_orders
  AFTER UPDATE ON public.work_types FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'work_type_name', 'work_orders', 'work_type_id', 'work_order_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_work_type_to_sas ON public.work_types;
CREATE TRIGGER trg_cascade_work_type_to_sas
  AFTER UPDATE ON public.work_types FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'work_type_name', 'service_appointments', 'work_type_id', 'sa_is_deleted');

-- A work order's name changes exactly when its project, unit or work type did —
-- the same inputs its appointments use, so this is the signal to refresh them.
DROP TRIGGER IF EXISTS trg_cascade_work_order_to_sas ON public.work_orders;
CREATE TRIGGER trg_cascade_work_order_to_sas
  AFTER UPDATE ON public.work_orders FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'work_order_name', 'service_appointments', 'work_order_id', 'sa_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_sa_name_to_assignments ON public.service_appointments;
CREATE TRIGGER trg_cascade_sa_name_to_assignments
  AFTER UPDATE ON public.service_appointments FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'sa_name', 'service_appointment_assignments', 'service_appointment_id', 'saa_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_user_name_to_assignments ON public.users;
CREATE TRIGGER trg_cascade_user_name_to_assignments
  AFTER UPDATE ON public.users FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'user_name', 'service_appointment_assignments', 'saa_user_id', 'saa_is_deleted');

-- Opportunity / building / property renames reach the assessments named after
-- them. (Opportunity already cascades to projects and incentive applications.)
DROP TRIGGER IF EXISTS trg_cascade_opportunity_name_to_assessments ON public.opportunities;
CREATE TRIGGER trg_cascade_opportunity_name_to_assessments
  AFTER UPDATE ON public.opportunities FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'opportunity_name', 'assessments', 'opportunity_id', 'assessment_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_building_name_to_assessments ON public.buildings;
CREATE TRIGGER trg_cascade_building_name_to_assessments
  AFTER UPDATE ON public.buildings FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'building_name', 'assessments', 'building_id', 'assessment_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_property_name_to_assessments ON public.properties;
CREATE TRIGGER trg_cascade_property_name_to_assessments
  AFTER UPDATE ON public.properties FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'property_name', 'assessments', 'property_id', 'assessment_is_deleted');

NOTIFY pgrst, 'reload schema';
