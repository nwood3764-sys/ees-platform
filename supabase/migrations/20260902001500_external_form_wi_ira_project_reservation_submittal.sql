-- The IRA HOMES Multifamily Project Submittal Form (Jotform 250306438751960) has
-- two branches selected by its "I'm Applying for a(n)" radio: "Final Installation
-- Payment Request" (already wired to the incentive application) and
-- "Project Reservation" (this — filed from the Project Reservation enrollment).
-- Same form, same field parameters; only the branch radio and the source record
-- differ, so this adds an enrollment-sourced resolver + target + field map. The
-- resolver is SECURITY INVOKER (reads the enrollment and its parents under the
-- caller's RLS) and adds no advisor lint.

CREATE OR REPLACE FUNCTION public.build_wi_ira_project_reservation_form_prefill(p_enrollment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_catalog'
AS $fn$
DECLARE
  en public.enrollments%ROWTYPE;
  ca public.accounts%ROWTYPE;
  cc public.contacts%ROWTYPE;
  pr public.properties%ROWTYPE;
  bl public.buildings%ROWTYPE;
  rt text;
BEGIN
  IF p_enrollment_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT e.* INTO en FROM public.enrollments e WHERE e.id = p_enrollment_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT picklist_value INTO rt FROM public.picklist_values WHERE id = en.enrollment_record_type;
  IF rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-Project-Reservation' THEN RETURN '{}'::jsonb; END IF;

  IF en.enrollment_contractor_account_id IS NOT NULL THEN
    SELECT x.* INTO ca FROM public.accounts x WHERE x.id = en.enrollment_contractor_account_id;
  END IF;
  IF en.enrollment_contractor_contact_id IS NOT NULL THEN
    SELECT x.* INTO cc FROM public.contacts x WHERE x.id = en.enrollment_contractor_contact_id;
  END IF;
  IF en.property_id IS NOT NULL THEN SELECT x.* INTO pr FROM public.properties x WHERE x.id = en.property_id; END IF;
  IF en.building_id IS NOT NULL THEN SELECT x.* INTO bl FROM public.buildings x WHERE x.id = en.building_id; END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'ia_application_for',            'Project Reservation',
    'ia_building_type',              (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_building_type),
    'ia_building_project_type',      (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_building_project_type),
    'has_support_contractor',        CASE WHEN en.enrollment_has_support_contractor IS TRUE THEN 'Yes'
                                          WHEN en.enrollment_has_support_contractor IS FALSE THEN 'No' END,
    'contractor_business_name',      ca.account_name,
    'contractor_contact_first_name', cc.contact_first_name,
    'contractor_contact_last_name',  cc.contact_last_name,
    'contractor_email',              cc.contact_email,
    'contractor_phone',              cc.contact_phone,
    'contractor_street',             ca.billing_street,
    'contractor_city',               ca.billing_city,
    'contractor_state',              ca.billing_state,
    'contractor_zip',                ca.billing_zip,
    'business_entity_name',          public.resolve_property_owner_name(en.property_id),
    'signer_contact_name',           NULLIF(BTRIM(COALESCE(en.enrollment_contact_name,'')), ''),
    'signer_contact_email',          en.enrollment_contact_email,
    'signer_contact_phone',          en.enrollment_contact_phone,
    'building_owner_name',           public.resolve_property_owner_name(en.property_id),
    'installation_street',           pr.property_street,
    'installation_city',             pr.property_city,
    'installation_state',            pr.property_state,
    'installation_zip',              pr.property_zip,
    'iq_code',                       bl.ira_confirmation_code_lea
  ));
END $fn$;

REVOKE ALL ON FUNCTION public.build_wi_ira_project_reservation_form_prefill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_project_reservation_form_prefill(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.build_external_form_prefill(p_key text, p_record_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_catalog'
AS $fn$
BEGIN
  IF p_key IS NULL OR p_record_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  CASE p_key
    WHEN 'wi_ira_mf_homes_assessment_preapproval' THEN RETURN public.build_wi_ira_assessment_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_assessment_application' THEN RETURN public.build_wi_ira_assessment_application_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_project_payment_request' THEN RETURN public.build_wi_ira_payment_request_form_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_project_reservation' THEN RETURN public.build_wi_ira_project_reservation_form_prefill(p_record_id);
    ELSE RETURN '{}'::jsonb;
  END CASE;
END $fn$;

INSERT INTO public.external_form_targets
  (eft_record_number, eft_key, eft_name, eft_description, eft_kind, eft_base_url, eft_form_provider,
   eft_external_form_id, eft_object, eft_record_type, eft_is_active, eft_owner, eft_created_by, eft_updated_by, is_seed_data)
SELECT '', 'wi_ira_mf_homes_project_reservation',
   'Focus On Energy - IRA HOMES Multifamily Project Submittal Form (Project Reservation)',
   'The Project Reservation branch of the IRA HOMES Multifamily Project Submittal Form, pre-filled from the Project Reservation enrollment.',
   t.eft_kind, t.eft_base_url, t.eft_form_provider, t.eft_external_form_id,
   'enrollments',
   (SELECT id FROM public.picklist_values
     WHERE picklist_object='enrollments' AND picklist_field='record_type'
       AND picklist_value='WI-IRA-MF-HOMES-Project-Reservation'),
   true, t.eft_owner, t.eft_owner, t.eft_owner, true
FROM public.external_form_targets t
WHERE t.eft_key = 'wi_ira_mf_homes_project_payment_request'
  AND NOT EXISTS (SELECT 1 FROM public.external_form_targets e WHERE e.eft_key='wi_ira_mf_homes_project_reservation');

INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
   efm_option_value_map, efm_field_label, efm_sort_order, efm_is_active, efm_is_required,
   efm_owner, efm_created_by, efm_updated_by, is_seed_data)
SELECT '', tgt.id, v.leap, v.param, v.xform, '{}'::jsonb, v.label, v.ord, true, v.req,
       tgt.eft_owner, tgt.eft_owner, tgt.eft_owner, true
FROM (SELECT id, eft_owner FROM public.external_form_targets WHERE eft_key='wi_ira_mf_homes_project_reservation') tgt,
LATERAL (VALUES
  ('ia_application_for','imApplying',NULL::text,'I''m Applying for a(n)',10,true),
  ('ia_building_type','buildingType255',NULL,'Building Type',20,true),
  ('ia_building_project_type','buildingProject261',NULL,'Building Project Type',30,true),
  ('contractor_business_name','primaryContractor28',NULL,'Primary Contractor Business Name',40,true),
  ('contractor_contact_first_name','primaryContractor[first]',NULL,'Primary Contractor First Name',50,true),
  ('contractor_contact_last_name','primaryContractor[last]',NULL,'Primary Contractor Last Name',60,true),
  ('contractor_email','email45',NULL,'Primary Contractor Email',70,true),
  ('contractor_phone','phoneNumber46[full]',NULL,'Primary Contractor Phone Number',80,true),
  ('contractor_street','primaryContractor116[addr_line1]',NULL,'Primary Contractor Address',90,true),
  ('contractor_city','primaryContractor116[city]',NULL,'Primary Contractor City',100,true),
  ('contractor_state','primaryContractor116[state]','state_2letter','Primary Contractor State',110,true),
  ('contractor_zip','primaryContractor116[postal]',NULL,'Primary Contractor ZIP',120,true),
  ('has_support_contractor','willA78',NULL,'Will a Support Contractor work on this project?',130,true),
  ('business_entity_name','businessEntity268',NULL,'Business Entity Name',140,true),
  ('signer_contact_name','contactName',NULL,'Contact Name',150,true),
  ('signer_contact_email','email',NULL,'Email',160,true),
  ('signer_contact_phone','phoneNumber[full]',NULL,'Phone Number',170,true),
  ('installation_street','installationAddress[addr_line1]',NULL,'Installation Address',180,true),
  ('installation_city','installationAddress[city]',NULL,'Installation City',190,true),
  ('installation_state','installationAddress[state]',NULL,'Installation State',200,true),
  ('installation_zip','installationAddress[postal]',NULL,'Installation ZIP',210,true),
  ('building_owner_name','buildingOwner[first]',NULL,'Building Owner Name',220,false),
  ('iq_code','incomequalifiedConfirmation',NULL,'Income-Qualified Confirmation Code',230,false)
) AS v(leap, param, xform, label, ord, req)
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_field_map m
  WHERE m.efm_target_id = tgt.id AND m.efm_is_deleted IS NOT TRUE);
