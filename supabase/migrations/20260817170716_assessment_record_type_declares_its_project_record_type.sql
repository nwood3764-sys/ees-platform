-- Which project record type an assessment's project gets is CONFIGURATION.
--
-- Nicholas, 2026-08-17: "multi-family energy assessment is the project record
-- type." derive_assessment_project() (20260817163750) matched a projects record
-- type by exact value against the assessment's record type, found no projects
-- record type literally named WI-IRA-MF-HOMES-AUDIT, and fell back to the
-- generic ASSESSMENT record type. Wrong answer, and the wrong SHAPE of answer:
-- the correct project record type differs per program — SINGLE-FAMILY-ENERGY-
-- ASSESSMENT, TOWNHOME-ENERGY-ASSESSMENT, MULTIFAMILY-DIAGNOSTIC-ASSESSMENT and
-- ASHRAE-LEVEL-1 all exist — so it can never be guessed from the value name.
--
-- It becomes a record-type setting, alongside the ones picklist_values already
-- carries (picklist_is_default_record_type, picklist_locks_record,
-- picklist_requires_income_qualification, icon, color), editable in
-- Admin → Object Manager → Record Types. Nothing about the mapping lives in code.
ALTER TABLE public.picklist_values
  ADD COLUMN IF NOT EXISTS picklist_project_record_type uuid
    REFERENCES public.picklist_values(id);

COMMENT ON COLUMN public.picklist_values.picklist_project_record_type IS
  'Record-type setting: the projects record type that a record of THIS record type rolls its work into. Read for assessments record types by derive_assessment_project(). Points at a picklist_values row with picklist_object=''projects'', picklist_field=''record_type''.';

-- Seed only what Nicholas stated: the WI multifamily audit assessment rolls into
-- a Multifamily Energy Assessment project. Every other assessment record type is
-- deliberately left unset for him to configure; the rule falls back rather than
-- guessing.
UPDATE public.picklist_values a
   SET picklist_project_record_type = (
        SELECT p.id FROM public.picklist_values p
         WHERE p.picklist_object = 'projects' AND p.picklist_field = 'record_type'
           AND p.picklist_value = 'MULTIFAMILY-ENERGY-ASSESSMENT'
         LIMIT 1)
 WHERE a.picklist_object = 'assessments' AND a.picklist_field = 'record_type'
   AND a.picklist_value = 'WI-IRA-MF-HOMES-AUDIT';

-- The rule now reads the setting first.
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
    RETURN NEW;  -- nothing to own it; leave the field rather than fail the insert
  END IF;

  -- Project record type, in order of authority:
  --   a. the projects record type this assessment record type declares
  --      (picklist_project_record_type) — the configured answer;
  --   b. a projects record type with the same value, for programs where the two
  --      lists genuinely share a name (ASHRAE-LEVEL-1);
  --   c. the purpose-built ASSESSMENT projects record type, as a last resort.
  SELECT arts.picklist_value, prt.id
    INTO v_rt_value, v_proj_rt
    FROM public.picklist_values arts
    LEFT JOIN public.picklist_values prt
           ON prt.id = arts.picklist_project_record_type
          AND prt.picklist_is_active
   WHERE arts.id = NEW.assessment_record_type;

  IF v_proj_rt IS NULL THEN
    SELECT pv.id INTO v_proj_rt
      FROM public.picklist_values pv
     WHERE pv.picklist_object = 'projects' AND pv.picklist_field = 'record_type'
       AND pv.picklist_is_active AND pv.picklist_value = v_rt_value
     LIMIT 1;
  END IF;
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

-- Correct the 12 projects the first pass created with the generic record type.
-- Scoped to exactly those rows: created by this rule, still on the fallback
-- ASSESSMENT record type, and carrying an assessment whose record type now
-- declares a project record type. Their names re-derive from the new label.
UPDATE public.projects p
   SET project_record_type = arts.picklist_project_record_type,
       project_name = ''
  FROM public.assessments a
  JOIN public.picklist_values arts ON arts.id = a.assessment_record_type
 WHERE a.project_id = p.id
   AND a.assessment_is_deleted IS NOT TRUE
   AND p.project_is_deleted IS NOT TRUE
   AND p.project_description = 'Created automatically to hold the work for this assessment.'
   AND arts.picklist_project_record_type IS NOT NULL
   AND p.project_record_type = (
        SELECT pv.id FROM public.picklist_values pv
         WHERE pv.picklist_object = 'projects' AND pv.picklist_field = 'record_type'
           AND pv.picklist_value = 'ASSESSMENT' LIMIT 1);

NOTIFY pgrst, 'reload schema';
