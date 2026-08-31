-- Open Assessment Application: the Focus On Energy IRA assessment application,
-- pre-filled from the incentive application.
--
-- The pre-approval enrollment has had this since 20260803194426 -- press a
-- button, the hosted form opens with LEAP's answers already in it. The AUDIT
-- incentive application, which is where the actual rebate claim is prepared, had
-- no such route: every field was keyed across by hand from the record beside it.
-- That is what "why is it not going ahead and populating stuff" was really
-- about.
--
-- Nothing new is invented here. external_form_targets / external_form_field_map
-- already hold the target URL and the per-field wiring, and the client already
-- assembles a Formstack prefill query string from them. This adds:
--
--   * the target row for focusonenergy.formstack.com/forms/ira_assessment_app,
--     against incentive_applications rather than enrollments;
--   * its field map, taken from the form's own rendered HTML -- the ids are the
--     form's, not guesses;
--   * build_wi_ira_assessment_application_prefill(), the resolver that reads the
--     application and its parents; and
--   * build_external_form_prefill(key, record), one entry point so the client
--     does not have to know which resolver belongs to which form.
--
-- THE FORM IS CONDITIONAL, which is the thing worth recording. It carries three
-- assessment-detail branches -- Individual Single Family (193332682-193332689),
-- Individual Multifamily Building (193332694-193332702, 197209537) and Multiple
-- Units up to 20 (193332707-193332708) -- and "How was the building modeled?"
-- (field193332678) chooses between them. Only the MULTIFAMILY branch is mapped,
-- because WI-IRA-MF-HOMES-AUDIT is a multifamily programme; a single-family
-- audit application would need its own target row against its own record type,
-- never a widening of this one. Filling a single-family field id from a
-- multifamily record would put data into a section the form never shows.
--
-- Deliberately NOT prefilled: the five attestations (193332725-193332729) and
-- the digital signature (193332730). A person affirms those on the form; LEAP
-- pre-ticking someone's certification would be a forgery, not a convenience.
-- The three file uploads cannot be prefilled by any URL and are attached in LEAP
-- so the assessor has them to hand.

-- 1) The target ---------------------------------------------------------------
DO $$
DECLARE
  v_owner  uuid;
  v_rt     uuid;
  v_target uuid;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
   ORDER BY user_created_at LIMIT 1;
  SELECT id INTO v_rt FROM public.picklist_values
   WHERE picklist_object='incentive_applications' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HOMES-AUDIT';
  IF v_rt IS NULL THEN RAISE EXCEPTION 'WI-IRA-MF-HOMES-AUDIT record type is missing'; END IF;

  SELECT id INTO v_target FROM public.external_form_targets
   WHERE eft_key='wi_ira_mf_homes_assessment_application' AND eft_is_deleted IS NOT TRUE;

  IF v_target IS NULL THEN
    INSERT INTO public.external_form_targets
      (eft_key, eft_name, eft_description, eft_kind, eft_base_url, eft_form_provider,
       eft_external_form_id, eft_object, eft_record_type, eft_submit_note,
       eft_is_active, eft_record_number, eft_owner, eft_created_by)
    VALUES ('wi_ira_mf_homes_assessment_application',
            'Focus On Energy - IRA HOMES Energy Assessment Incentive Payment Application',
            'The assessment rebate claim, filed after the assessment is done. Distinct from the pre-approval form, which is filed from the enrollment before it.',
            'prefill_url',
            'https://focusonenergy.formstack.com/forms/ira_assessment_app',
            'formstack', 'ira_assessment_app',
            'incentive_applications', v_rt,
            'Attach the Asset Score, BuildingSync file and invoice on the form itself — a URL cannot carry a file. Then read down the form, affirm the five statements and sign.',
            true, '', v_owner, v_owner)
    RETURNING id INTO v_target;
  END IF;

  -- 2) The field map ----------------------------------------------------------
  -- param, leap key, transform, required, label, sort
  INSERT INTO public.external_form_field_map
    (efm_target_id, efm_external_param, efm_leap_field, efm_value_transform,
     efm_option_value_map, efm_field_label, efm_is_required, efm_sort_order,
     efm_is_active, efm_record_number, efm_owner, efm_created_by)
  SELECT v_target, m.param, m.leap, m.transform, '{}'::jsonb, m.label, m.req, m.sort,
         true, '', v_owner, v_owner
    FROM (VALUES
      ('field193332678',        'building_modeled_as',            NULL,             'How was the building modeled?',            true,   10),
      ('field193332679',        'multiple_properties_same_owner', 'bool_yes_no',    'Requesting incentives for more than one property or unit owned by the same person or entity?', true, 20),
      ('field193332694',        'property_owner_name',            NULL,             'Property Owner Name',                      true,   30),
      ('field193332695',        'building_name',                  NULL,             'Building name',                            false,  40),
      ('field193332696-address','assessment_address_line1',       NULL,             'Assessment Address - street',              true,   50),
      ('field193332696-address2','assessment_address_line2',      NULL,             'Assessment Address - line 2',              false,  60),
      ('field193332696-city',   'assessment_city',                NULL,             'Assessment Address - city',                true,   70),
      ('field193332696-state',  'assessment_state',               'state_2letter',  'Assessment Address - state',               true,   80),
      ('field193332696-zip',    'assessment_zip',                 NULL,             'Assessment Address - ZIP',                 true,   90),
      ('field193332697',        'units_per_building',             NULL,             'How many units are in the building?',      true,  100),
      ('field193332698',        'modeling_software_used',         NULL,             'What modeling software was used?',         true,  110),
      ('field193332699',        'ira_income_code',                NULL,             'IRA Income Code',                          true,  120),
      ('field193332700M',       'assessment_date',                'date_month_abbr','Assessment Date',                          true,  130),
      ('field193332700D',       'assessment_date',                'date_day',       'Assessment Date',                          true,  140),
      ('field193332700Y',       'assessment_date',                'date_year',      'Assessment Date',                          true,  150),
      ('field193332701',        'assessment_cost',                'money_plain',    'Assessment Cost',                          true,  160),
      ('field193332702',        'requested_incentive_amount',     'money_plain',    'Requested Incentive Amount',               true,  170),
      ('field197209537',        'building_improvements',          NULL,             'Building Improvements',                    true,  180),
      ('field193332714',        'contractor_business_name',       NULL,             'Registered Contractor - Business Name',    true,  190),
      ('field193332716-address','contractor_office_street',       NULL,             'Office Address - street',                  true,  200),
      ('field193332716-city',   'contractor_office_city',         NULL,             'Office Address - city',                    true,  210),
      ('field193332716-state',  'contractor_office_state',        'state_2letter',  'Office Address - state',                   true,  220),
      ('field193332716-zip',    'contractor_office_zip',          NULL,             'Office Address - ZIP',                     true,  230),
      ('field193332717-address','payment_street',                 NULL,             'Payment Address - street',                 true,  240),
      ('field193332717-address2','payment_line2',                 NULL,             'Payment Address - line 2',                 false, 250),
      ('field193332717-city',   'payment_city',                   NULL,             'Payment Address - city',                   true,  260),
      ('field193332717-state',  'payment_state',                  'state_2letter',  'Payment Address - state',                  true,  270),
      ('field193332717-zip',    'payment_zip',                    NULL,             'Payment Address - ZIP',                    true,  280),
      ('field193332718',        'contractor_phone',               NULL,             'Phone',                                    false, 290),
      ('field193332719',        'contractor_email',               NULL,             'Email',                                    true,  300),
      ('field193332721',        'moving_forward_with_homes',      NULL,             'Will the customer be moving forward with a HOMES project?', false, 310),
      ('field193332722',        'additional_comments',            NULL,             'Additional Comments',                      false, 320)
    ) AS m(param, leap, transform, label, req, sort)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.external_form_field_map x
      WHERE x.efm_target_id = v_target AND x.efm_external_param = m.param
        AND x.efm_is_deleted IS NOT TRUE);

  PERFORM 1;
  IF (SELECT count(*) FROM public.external_form_field_map
       WHERE efm_target_id = v_target AND efm_is_active AND efm_is_deleted IS NOT TRUE) <> 32 THEN
    RAISE EXCEPTION 'Expected 32 mapped parameters on the assessment application, found %',
      (SELECT count(*) FROM public.external_form_field_map
        WHERE efm_target_id = v_target AND efm_is_active AND efm_is_deleted IS NOT TRUE);
  END IF;

  -- Every id mapped here must belong to the MULTIFAMILY branch (or the shared
  -- header/assessor/footer fields). A single-family id slipping in would fill a
  -- section this form never shows for a multifamily application.
  IF EXISTS (
    SELECT 1 FROM public.external_form_field_map
     WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE
       AND substring(efm_external_param from 'field(\d+)') IN
           ('193332682','193332683','193332684','193332685','193332686','193332687',
            '193332688','193332689','193332707','193332708'))
  THEN
    RAISE EXCEPTION 'A single-family or multiple-units field id is mapped on the multifamily application';
  END IF;
END $$;

-- 3) The resolver -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_wi_ira_assessment_application_prefill(p_incentive_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  ia public.incentive_applications%ROWTYPE;
  b  public.buildings%ROWTYPE;
  ca public.accounts%ROWTYPE;
  rt text;
BEGIN
  IF p_incentive_application_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- SECURITY INVOKER: the caller sees exactly what RLS lets them see. An
  -- application they cannot read returns {} rather than leaking a form full of
  -- another state's data.
  SELECT a.* INTO ia FROM public.incentive_applications a
   WHERE a.id = p_incentive_application_id AND a.ia_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT picklist_value INTO rt FROM public.picklist_values WHERE id = ia.ia_record_type;
  IF rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-AUDIT' THEN RETURN '{}'::jsonb; END IF;

  IF ia.building_id IS NOT NULL THEN
    SELECT x.* INTO b FROM public.buildings x WHERE x.id = ia.building_id;
  END IF;
  IF ia.ia_contractor_account_id IS NOT NULL THEN
    SELECT x.* INTO ca FROM public.accounts x WHERE x.id = ia.ia_contractor_account_id;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'building_modeled_as',            (SELECT picklist_label FROM public.picklist_values WHERE id = ia.ia_building_modeled_as),
    'multiple_properties_same_owner', ia.ia_multiple_properties_same_owner,
    'property_owner_name',            ia.ia_property_owner_name,
    'building_name',                  b.building_name,
    'assessment_address_line1',       b.building_address,
    'assessment_address_line2',       ia.ia_assessment_address_line2,
    'assessment_city',                b.building_city,
    'assessment_state',               b.building_state,
    'assessment_zip',                 b.building_zip,
    'units_per_building',             ia.ia_units_per_building,
    'modeling_software_used',         (SELECT picklist_label FROM public.picklist_values WHERE id = ia.ia_modeling_software_used),
    'ira_income_code',                ia.ia_ira_income_code,
    'assessment_date',                to_char(ia.ia_assessment_date, 'YYYY-MM-DD'),
    'assessment_cost',                ia.ia_assessment_cost,
    'requested_incentive_amount',     ia.ia_requested_incentive_amount,
    'building_improvements',          ia.ia_building_improvements,
    'contractor_business_name',       ca.account_name,
    'contractor_office_street',       ca.billing_street,
    'contractor_office_city',         ca.billing_city,
    'contractor_office_state',        ca.billing_state,
    'contractor_office_zip',          ca.billing_zip,
    'payment_street',                 ia.ia_payment_mailing_street,
    'payment_line2',                  ia.ia_payment_mailing_line2,
    'payment_city',                   ia.ia_payment_mailing_city,
    'payment_state',                  ia.ia_payment_mailing_state,
    'payment_zip',                    ia.ia_payment_mailing_zip,
    'contractor_phone',               ca.account_phone,
    'contractor_email',               ca.account_email,
    'moving_forward_with_homes',      (SELECT picklist_label FROM public.picklist_values WHERE id = ia.ia_moving_forward_with_homes),
    'additional_comments',            ia.ia_additional_comments
  ));
END
$function$;

REVOKE ALL ON FUNCTION public.build_wi_ira_assessment_application_prefill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_assessment_application_prefill(uuid) TO authenticated;

-- 4) One entry point ----------------------------------------------------------
-- The client asks for a target key and a record id; which resolver runs is
-- decided here. Deliberately a CASE over known keys, not a dynamic EXECUTE of a
-- function name held in a data row -- a table anyone can edit must never be able
-- to name the code that runs.
CREATE OR REPLACE FUNCTION public.build_external_form_prefill(p_key text, p_record_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_key IS NULL OR p_record_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  CASE p_key
    WHEN 'wi_ira_mf_homes_assessment_preapproval' THEN
      RETURN public.build_wi_ira_assessment_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_assessment_application' THEN
      RETURN public.build_wi_ira_assessment_application_prefill(p_record_id);
    ELSE
      RETURN '{}'::jsonb;
  END CASE;
END
$function$;

REVOKE ALL ON FUNCTION public.build_external_form_prefill(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_external_form_prefill(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
