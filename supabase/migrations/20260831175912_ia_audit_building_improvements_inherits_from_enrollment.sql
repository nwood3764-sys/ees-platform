-- WI-IRA-MF-HOMES-AUDIT: "Building Improvements" inherits from the pre-approval
-- enrollment, like every other field on that application already does.
--
-- Reported: an assessment incentive application (IA-00042, 779 Maple Avenue)
-- showed blanks where the assessor expected the record to have populated
-- itself, and the Focus On Energy assessment application
-- (focusonenergy.formstack.com/forms/ira_assessment_app) marks Building
-- Improvements REQUIRED.
--
-- The population engine was not broken. incentive_application_enrollment_field_map
-- carries 12 mappings for this record type and all 12 landed on the record.
-- Building Improvements simply was never one of them -- while the pre-approval
-- enrollment holds exactly that text in enrollment_building_details ("List out
-- all proposed measures that were modeled for this property" on the pre-approval
-- form is the same question the assessment application asks). The value was one
-- row up the chain the whole time and nothing carried it across.
--
-- Additive: the trigger only fills a column that is still NULL, so no application
-- that already carries its own Building Improvements text can be overwritten.

DO $$
DECLARE
  v_ia_rt  uuid;
  v_enr_rt uuid;
  v_owner  uuid;
  v_n      integer;
BEGIN
  SELECT id INTO v_ia_rt FROM public.picklist_values
   WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type'
     AND picklist_value = 'WI-IRA-MF-HOMES-AUDIT';
  SELECT id INTO v_enr_rt FROM public.picklist_values
   WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type'
     AND picklist_value = 'WI-IRA-MF-HOMES-Assessment-Preapproval';
  IF v_ia_rt IS NULL OR v_enr_rt IS NULL THEN
    RAISE EXCEPTION 'Audit application or pre-approval enrollment record type is missing';
  END IF;

  SELECT id INTO v_owner FROM public.users
   WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
     ORDER BY user_created_at LIMIT 1;
  END IF;

  -- Both columns must exist before a mapping can name them; a mapping onto a
  -- column that is not there fails at INSERT time on a live record, not here.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='incentive_applications'
                    AND column_name='ia_building_improvements') THEN
    RAISE EXCEPTION 'incentive_applications.ia_building_improvements does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='enrollments'
                    AND column_name='enrollment_building_details') THEN
    RAISE EXCEPTION 'enrollments.enrollment_building_details does not exist';
  END IF;

  INSERT INTO public.incentive_application_enrollment_field_map
    (iaef_ia_record_type, iaef_enrollment_record_type, iaef_ia_column,
     iaef_enrollment_column, iaef_value_transform, iaef_option_value_map,
     iaef_sort_order, iaef_notes, iaef_record_number, iaef_owner, iaef_created_by)
  VALUES (v_ia_rt, v_enr_rt, 'ia_building_improvements',
          'enrollment_building_details', NULL, '{}'::jsonb,
          140,
          'Both forms ask for the modeled measures; the pre-approval collects it first.',
          '', v_owner, v_owner)
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_n FROM public.incentive_application_enrollment_field_map
   WHERE iaef_ia_record_type = v_ia_rt AND iaef_is_deleted = false AND iaef_is_active;
  IF v_n <> 13 THEN
    RAISE EXCEPTION 'Expected 13 live mappings for the audit application, found %', v_n;
  END IF;
END $$;

-- Carry the value onto the applications that were created before the mapping
-- existed. Only where the application has nothing of its own to lose.
--
-- session_replication_role = replica so the backfill does not run the audit
-- logger (this is a migration filling a column, not a person editing eight
-- records) and does not restamp ia_updated_at/ia_updated_by.
DO $$
DECLARE
  v_before integer;
  v_after  integer;
BEGIN
  SELECT count(*) INTO v_before
    FROM public.incentive_applications ia
    JOIN public.picklist_values rt ON rt.id = ia.ia_record_type
   WHERE rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND ia.ia_is_deleted IS NOT TRUE
     AND NULLIF(BTRIM(ia.ia_building_improvements), '') IS NULL;

  SET LOCAL session_replication_role = replica;

  UPDATE public.incentive_applications ia
     SET ia_building_improvements = src.enrollment_building_details
    FROM (
      SELECT ia2.id AS ia_id, e.enrollment_building_details
        FROM public.incentive_applications ia2
        JOIN public.picklist_values rt ON rt.id = ia2.ia_record_type
       CROSS JOIN LATERAL (
              SELECT en.enrollment_building_details
                FROM public.enrollments en
               WHERE en.opportunity_id = ia2.opportunity_id
                 AND en.enrollment_is_deleted IS NOT TRUE
                 AND en.enrollment_record_type = (
                       SELECT id FROM public.picklist_values
                        WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type'
                          AND picklist_value = 'WI-IRA-MF-HOMES-Assessment-Preapproval')
               ORDER BY COALESCE(en.enrollment_updated_at, en.enrollment_created_at) DESC,
                        en.enrollment_created_at DESC, en.id
               LIMIT 1) e
       WHERE rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
         AND ia2.ia_is_deleted IS NOT TRUE
         AND NULLIF(BTRIM(ia2.ia_building_improvements), '') IS NULL
         AND NULLIF(BTRIM(e.enrollment_building_details), '') IS NOT NULL
    ) src
   WHERE ia.id = src.ia_id;

  SET LOCAL session_replication_role = origin;

  SELECT count(*) INTO v_after
    FROM public.incentive_applications ia
    JOIN public.picklist_values rt ON rt.id = ia.ia_record_type
   WHERE rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND ia.ia_is_deleted IS NOT TRUE
     AND NULLIF(BTRIM(ia.ia_building_improvements), '') IS NULL;

  RAISE NOTICE 'Building Improvements blank on audit applications: % before, % after (the remainder have no pre-approval enrollment carrying the text)',
    v_before, v_after;
END $$;
