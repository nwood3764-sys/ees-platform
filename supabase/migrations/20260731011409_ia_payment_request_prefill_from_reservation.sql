-- Pre-fill a Project Payment Request from the reservation enrollment on the
-- same opportunity.
--
-- The WI-IRA-MF-HOMES reservation (an enrollment) and the Project Payment
-- Request (an incentive_application) are the same program on the same
-- opportunity at two stages. Everything the reservation already captured should
-- carry forward instead of being re-keyed. Parent-inherited values (address,
-- units, utilities…) already resolve read-only on the payment-request layout;
-- this handles the reservation's OWN captured answers.
--
-- Picklist answers can't be copied by id — the enrollment picklists and the
-- incentive_applications picklists are separate rows — so each is translated by
-- its value string via picklist_value_translate().

-- Translate a picklist value id from whatever object/field it lives on to the
-- equivalently-labeled active value on a target object/field.
CREATE OR REPLACE FUNCTION public.picklist_value_translate(
  p_src_id uuid, p_tgt_object text, p_tgt_field text
) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT t.id
  FROM public.picklist_values s
  JOIN public.picklist_values t
    ON t.picklist_object = p_tgt_object
   AND t.picklist_field  = p_tgt_field
   AND lower(btrim(t.picklist_value)) = lower(btrim(s.picklist_value))
   AND t.picklist_is_active
  WHERE s.id = p_src_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.build_ia_payment_request_prefill(p_opportunity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  e public.enrollments%ROWTYPE;
BEGIN
  IF p_opportunity_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- The reservation enrollment on this opportunity (latest active).
  SELECT en.* INTO e
  FROM public.enrollments en
  JOIN public.picklist_values rt ON rt.id = en.enrollment_record_type
  WHERE en.opportunity_id = p_opportunity_id
    AND en.enrollment_is_deleted IS NOT TRUE
    AND rt.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation'
  ORDER BY en.enrollment_updated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    -- Parent chain (so the inherited read-only fields resolve immediately).
    'opportunity_id', e.opportunity_id,
    'property_id',    e.property_id,
    'building_id',    e.building_id,
    -- Direct copies — same shape on both objects.
    'ia_contractor_account_id',         e.enrollment_contractor_account_id,
    'ia_contractor_contact_id',         e.enrollment_contractor_contact_id,
    'ia_has_support_contractor',        e.enrollment_has_support_contractor,
    'ia_support_contractor_account_id', e.enrollment_support_contractor_account_id,
    'ia_support_contractor_contact_id', e.enrollment_support_contractor_contact_id,
    'ia_submitted_by',                  e.enrollment_submitted_by,
    'ia_total_project_cost',            e.enrollment_total_project_cost,
    'ia_work_completed',                e.enrollment_work_measures,
    -- This record IS the payment request, so fix the application type.
    'ia_application_for', (
      SELECT id FROM public.picklist_values
      WHERE picklist_object='incentive_applications' AND picklist_field='application_for'
        AND picklist_value='Final Installation Payment Request' AND picklist_is_active LIMIT 1),
    -- Picklists translated by value string (enrollment field -> ia field).
    'ia_building_type',         public.picklist_value_translate(e.enrollment_building_type,         'incentive_applications','building_type'),
    'ia_building_project_type', public.picklist_value_translate(e.enrollment_building_project_type, 'incentive_applications','building_project_type'),
    'ia_income_level',          public.picklist_value_translate(e.enrollment_income_level,          'incentive_applications','income_level'),
    'ia_heating_type',          public.picklist_value_translate(e.enrollment_heating_type,          'incentive_applications','heating_type'),
    'ia_who_gets_paid',         public.picklist_value_translate(e.enrollment_payee,                 'incentive_applications','who_gets_paid'),
    'ia_tax_classification_type', public.picklist_value_translate(e.enrollment_tax_classification,  'incentive_applications','tax_classification_type'),
    'ia_modeling_software',     public.picklist_value_translate(e.enrollment_modeling_software,     'incentive_applications','modeling_software')
  ));
END $$;

REVOKE ALL ON FUNCTION public.picklist_value_translate(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.build_ia_payment_request_prefill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picklist_value_translate(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_ia_payment_request_prefill(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
