-- Assessment Cost stops being a blank the assessor has to remember.
--
-- Nicholas: "assessment will always be 2,000."
--
-- True of the data as well as the programme: all 8 live audit applications carry
-- a $2,000 requested incentive, and every pre-approval enrollment behind them
-- records enrollment_requested_incentive_amount = 2000. The Focus On Energy
-- assessment application asks for BOTH figures and enforces "incentive cannot
-- exceed the cost of the assessment" -- so with the two equal, the form is
-- satisfied by equality.
--
-- The number is NOT written into a trigger or a column default. $2,000 is the
-- programme's assessment incentive, and the place LEAP already records it for a
-- given building is the pre-approval enrollment -- which is also where the
-- Requested Incentive Amount on this same application comes from. So Assessment
-- Cost is a 14th row in the field map, drawing on that same enrollment column.
-- If Focus On Energy ever moves off $2,000, the enrollment says so and both
-- fields follow; nothing here needs editing.
--
-- Fills a blank only, so an application that was invoiced at some other figure
-- keeps it.

DO $$
DECLARE
  v_ia_rt  uuid;
  v_enr_rt uuid;
  v_owner  uuid;
  v_n      integer;
BEGIN
  SELECT id INTO v_ia_rt FROM public.picklist_values
   WHERE picklist_object='incentive_applications' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HOMES-AUDIT';
  SELECT id INTO v_enr_rt FROM public.picklist_values
   WHERE picklist_object='enrollments' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HOMES-Assessment-Preapproval';
  IF v_ia_rt IS NULL OR v_enr_rt IS NULL THEN
    RAISE EXCEPTION 'Audit application or pre-approval enrollment record type is missing';
  END IF;

  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
   ORDER BY user_created_at LIMIT 1;

  INSERT INTO public.incentive_application_enrollment_field_map
    (iaef_ia_record_type, iaef_enrollment_record_type, iaef_ia_column,
     iaef_enrollment_column, iaef_value_transform, iaef_option_value_map,
     iaef_sort_order, iaef_notes, iaef_record_number, iaef_owner, iaef_created_by)
  VALUES (v_ia_rt, v_enr_rt, 'ia_assessment_cost',
          'enrollment_requested_incentive_amount', NULL, '{}'::jsonb, 150,
          'The programme pays the full assessment cost, so cost and requested incentive are the same figure the enrollment already records. Keeps the form''s "incentive cannot exceed the cost" rule satisfied.',
          '', v_owner, v_owner)
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_n FROM public.incentive_application_enrollment_field_map
   WHERE iaef_ia_record_type = v_ia_rt AND iaef_is_deleted = false AND iaef_is_active;
  IF v_n <> 14 THEN
    RAISE EXCEPTION 'Expected 14 live mappings for the audit application, found %', v_n;
  END IF;
END $$;

DO $$
DECLARE
  v_blank integer;
BEGIN
  SET LOCAL session_replication_role = replica;

  UPDATE public.incentive_applications ia
     SET ia_assessment_cost = src.amount
    FROM (
      SELECT ia2.id AS ia_id, e.enrollment_requested_incentive_amount AS amount
        FROM public.incentive_applications ia2
        JOIN public.picklist_values rt ON rt.id = ia2.ia_record_type
       CROSS JOIN LATERAL (
              SELECT en.enrollment_requested_incentive_amount
                FROM public.enrollments en
               WHERE en.opportunity_id = ia2.opportunity_id
                 AND en.enrollment_is_deleted IS NOT TRUE
                 AND en.enrollment_record_type = (
                       SELECT id FROM public.picklist_values
                        WHERE picklist_object='enrollments' AND picklist_field='record_type'
                          AND picklist_value='WI-IRA-MF-HOMES-Assessment-Preapproval')
               ORDER BY COALESCE(en.enrollment_updated_at, en.enrollment_created_at) DESC,
                        en.enrollment_created_at DESC, en.id
               LIMIT 1) e
       WHERE rt.picklist_value='WI-IRA-MF-HOMES-AUDIT'
         AND ia2.ia_is_deleted IS NOT TRUE
         AND ia2.ia_assessment_cost IS NULL
         AND e.enrollment_requested_incentive_amount IS NOT NULL
    ) src
   WHERE ia.id = src.ia_id;

  SET LOCAL session_replication_role = origin;

  SELECT count(*) INTO v_blank
    FROM public.incentive_applications ia
    JOIN public.picklist_values rt ON rt.id = ia.ia_record_type
   WHERE rt.picklist_value='WI-IRA-MF-HOMES-AUDIT'
     AND ia.ia_is_deleted IS NOT TRUE AND ia.ia_assessment_cost IS NULL;

  RAISE NOTICE 'Audit applications still without an assessment cost: % (no pre-approval enrollment to read one from)', v_blank;
END $$;

-- HA-00192 listed Assessment Cost under "never inherited". It inherits now.
DO $$
DECLARE
  v_body text; v_new text;
BEGIN
  SELECT ha_body_markdown INTO v_body FROM public.help_articles
   WHERE ha_record_number='HA-00192' AND ha_is_deleted IS NOT TRUE;
  IF v_body IS NULL THEN RAISE EXCEPTION 'HA-00192 not found'; END IF;

  v_new := replace(v_body,
    '- Building Improvements (the pre-approval''s Building Details — both forms ask for the measures that were modeled)',
    '- Building Improvements (the pre-approval''s Building Details — both forms ask for the measures that were modeled)'
    || E'\n- Assessment Cost — the programme pays the full cost of the assessment, so it comes from the same enrollment figure as the Requested Incentive Amount, which is what keeps the form''s "incentive cannot exceed the cost" rule satisfied');

  v_new := replace(v_new,
    'Never inherited, because the form asks for facts the enrollment does not hold: **Assessment Cost**, the HOMES follow-up question, the more-than-one-property question, the attestations and the signature.',
    'Never inherited, because the form asks for facts the enrollment does not hold: the HOMES follow-up question, the more-than-one-property question, the attestations and the signature.');

  IF v_new = v_body THEN
    RAISE EXCEPTION 'HA-00192 was not changed — its wording no longer matches';
  END IF;
  IF v_new LIKE '%does not hold: **Assessment Cost**%' THEN
    RAISE EXCEPTION 'HA-00192 still lists Assessment Cost as never inherited';
  END IF;

  UPDATE public.help_articles SET ha_body_markdown = v_new, ha_updated_at = now()
   WHERE ha_record_number='HA-00192';
END $$;
