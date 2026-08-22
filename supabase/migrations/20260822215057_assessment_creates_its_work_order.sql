-- Creating an assessment creates its work order.
--
-- Nicholas, 2026-08-22: "when I create an assessment, the work order needs to be
-- created too for the record day. Automatically when the record is created."
--
-- The assessment that prompted this (ASMT-00025, Rocky Mount) had an empty Work
-- Orders card: nothing on the assessments table ever created one, so the field
-- crew had nothing to execute and every assessment needed a manual follow-up.
--
-- Which work type an assessment produces is CONFIGURATION, not code. This adds
-- picklist_values.picklist_work_type_id, mirroring picklist_project_record_type
-- (added 2026-08-17 so an assessment record type could declare its project
-- record type, read by derive_assessment_project). Same idea, same shape: the
-- record type declares its work type, and a state changes its own answer without
-- a deploy.
--
-- Nothing else is needed to get a full work plan: _trg_instantiate_work_plan_on_wo_insert
-- already fires on every work order insert and builds the plan and all its steps
-- from work_types.work_type_default_work_plan_template_id. So this trigger only
-- has to create the work order; the 15- or 17-step plan follows on its own.

ALTER TABLE public.picklist_values
  ADD COLUMN IF NOT EXISTS picklist_work_type_id uuid REFERENCES public.work_types(id);

COMMENT ON COLUMN public.picklist_values.picklist_work_type_id IS
  'For an assessments record type: the work type its assessments create a work order for. Read by create_assessment_work_order_on_insert(). Null = no work order is created.';

-- ---------------------------------------------------------------------------
-- Wire each IRA assessment record type to its own state''s work type.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_pair  record;
  v_wired integer := 0;
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('WI-IRA-MF-HOMES-AUDIT', 'Multifamily Energy Assessment'),
      ('WI-IRA-SF-HOMES-AUDIT', 'Single-Family Energy Assessment'),
      ('NC-IRA-MF-HOMES-AUDIT', 'NC-IRA-MF-HOMES-AUDIT Energy Assessment'),
      ('NC-IRA-SF-HOMES-AUDIT', 'NC-IRA-SF-HOMES-AUDIT Energy Assessment'),
      ('MI-IRA-MF-HOMES-AUDIT', 'MI-IRA-MF-HOMES-AUDIT Energy Assessment'),
      ('MI-IRA-SF-HOMES-AUDIT', 'MI-IRA-SF-HOMES-AUDIT Energy Assessment')
    ) AS t(record_type, work_type)
  LOOP
    UPDATE public.picklist_values pv
       SET picklist_work_type_id = wt.id
      FROM public.work_types wt
     WHERE pv.picklist_object = 'assessments'
       AND pv.picklist_field  = 'record_type'
       AND pv.picklist_value  = v_pair.record_type
       AND wt.work_type_name  = v_pair.work_type
       AND wt.work_type_is_deleted IS NOT TRUE
       AND pv.picklist_work_type_id IS DISTINCT FROM wt.id;
    v_wired := v_wired + 1;
  END LOOP;
  RAISE NOTICE 'Wired % assessment record type(s) to a work type.', v_wired;
END $do$;

-- ---------------------------------------------------------------------------
-- The trigger. AFTER INSERT, because work_orders.assessment_id needs NEW.id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_assessment_work_order_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_wt      public.work_types%ROWTYPE;
  v_actor   uuid;
  v_status  uuid;
  v_account uuid;
  v_label   text;
  v_new     uuid;
BEGIN
  -- The record type decides. No work type configured -> no work order, silently:
  -- most assessment record types are not field-documented programs, and an
  -- assessment must never fail to save because of a missing configuration.
  SELECT wt.* INTO v_wt
    FROM public.picklist_values pv
    JOIN public.work_types wt ON wt.id = pv.picklist_work_type_id
   WHERE pv.id = NEW.assessment_record_type
     AND wt.work_type_is_deleted IS NOT TRUE
     AND wt.work_type_is_active;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- work_orders requires project, opportunity and property (all NOT NULL).
  -- derive_assessment_project() fills project_id whenever the assessment has an
  -- opportunity, so in practice this only skips assessments with no opportunity.
  IF NEW.project_id IS NULL OR NEW.opportunity_id IS NULL OR NEW.property_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Idempotent: never a second work order for the same assessment. Makes a
  -- re-run, a restore, or a future backfill safe.
  IF EXISTS (
    SELECT 1 FROM public.work_orders
     WHERE assessment_id = NEW.id AND work_order_is_deleted IS NOT TRUE
  ) THEN
    RETURN NULL;
  END IF;

  v_actor := COALESCE(public.current_app_user_id(), NEW.assessment_owner, NEW.assessment_created_by);
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_status
    FROM public.picklist_values
   WHERE picklist_object = 'work_orders' AND picklist_field = 'work_order_status'
     AND picklist_value = 'New' AND picklist_is_active
   LIMIT 1;

  SELECT pr.property_account_id INTO v_account
    FROM public.properties pr WHERE pr.id = NEW.property_id;

  SELECT COALESCE(b.building_name, p.property_name, NEW.assessment_record_number)
    INTO v_label
    FROM (SELECT 1) z
    LEFT JOIN public.buildings  b ON b.id = NEW.building_id
    LEFT JOIN public.properties p ON p.id = NEW.property_id;

  INSERT INTO public.work_orders (
    work_order_record_number, work_order_name, work_order_owner, work_order_created_by,
    opportunity_id, project_id, property_id, building_id, work_order_account_id,
    assessment_id, work_type_id, work_order_record_type, work_order_status,
    work_order_subject, work_order_description
  ) VALUES (
    '', v_wt.work_type_name || ' - ' || COALESCE(v_label, ''), v_actor, v_actor,
    NEW.opportunity_id, NEW.project_id, NEW.property_id, NEW.building_id, v_account,
    NEW.id, v_wt.id, v_wt.work_type_default_work_order_record_type, v_status,
    v_wt.work_type_name,
    'Created automatically with assessment ' || COALESCE(NEW.assessment_record_number, '') || '.'
  ) RETURNING id INTO v_new;

  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_assessment_work_order_on_insert() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assessment_creates_work_order ON public.assessments;
CREATE TRIGGER trg_assessment_creates_work_order
  AFTER INSERT ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.create_assessment_work_order_on_insert();

NOTIFY pgrst, 'reload schema';
