-- Carry the configurable list onto the Jotform.
--   Unit Number -> q217_unitName ("Unit Name or Number")
--   IQ Code     -> q271_incomequalifiedConfirmation ("Income-Qualified
--                  Confirmation Code"), which is the building's LEA number.
-- Neither is required on the form, so neither gates the completeness check --
-- a submittal for a building whose LEA has not been issued yet still opens.
INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param,
   efm_field_label, efm_is_required, efm_sort_order, efm_owner, efm_created_by)
SELECT '', t.id, m.leap, m.param, m.label, false, m.ord, u.id, u.id
FROM public.external_form_targets t,
     (SELECT id FROM public.users WHERE id='c5a01ec8-960f-42ab-8a9e-a49822de89af') u,
     (VALUES
       ('ia_unit_number', 'q217_unitName',                    'Unit Name or Number',                420),
       ('iq_code',        'q271_incomequalifiedConfirmation', 'Income-Qualified Confirmation Code', 430)
     ) AS m(leap, param, label, ord)
WHERE t.eft_key = 'wi_ira_mf_homes_project_payment_request' AND t.eft_is_deleted IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.external_form_field_map x
     WHERE x.efm_target_id = t.id AND x.efm_leap_field = m.leap AND x.efm_is_deleted IS NOT TRUE);

-- Resolves a payment request into the values its Jotform map expects.
-- SECURITY INVOKER: the caller sees exactly what RLS lets them see, and an
-- application they cannot read returns {} rather than a form full of someone
-- else's data -- the same rule the assessment builders follow.
CREATE OR REPLACE FUNCTION public.build_wi_ira_payment_request_form_prefill(p_incentive_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  ia public.incentive_applications%ROWTYPE;
  ca public.accounts%ROWTYPE;
  cc public.contacts%ROWTYPE;
  sc public.contacts%ROWTYPE;
  pr public.properties%ROWTYPE;
  bl public.buildings%ROWTYPE;
  rt text;
BEGIN
  IF p_incentive_application_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT a.* INTO ia FROM public.incentive_applications a
   WHERE a.id = p_incentive_application_id AND a.ia_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT picklist_value INTO rt FROM public.picklist_values WHERE id = ia.ia_record_type;
  IF rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST' THEN RETURN '{}'::jsonb; END IF;

  IF ia.ia_contractor_account_id IS NOT NULL THEN
    SELECT x.* INTO ca FROM public.accounts x WHERE x.id = ia.ia_contractor_account_id;
  END IF;
  IF ia.ia_contractor_contact_id IS NOT NULL THEN
    SELECT x.* INTO cc FROM public.contacts x WHERE x.id = ia.ia_contractor_contact_id;
  END IF;
  IF ia.ia_signer_contact_id IS NOT NULL THEN
    SELECT x.* INTO sc FROM public.contacts x WHERE x.id = ia.ia_signer_contact_id;
  END IF;
  IF ia.property_id IS NOT NULL THEN
    SELECT x.* INTO pr FROM public.properties x WHERE x.id = ia.property_id;
  END IF;
  IF ia.building_id IS NOT NULL THEN
    SELECT x.* INTO bl FROM public.buildings x WHERE x.id = ia.building_id;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    -- Picklists: the form's option values and LEAP's picklist values are the
    -- same strings, so the stored value goes straight through untranslated.
    'ia_application_for',           (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_application_for),
    'ia_building_type',             (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_building_type),
    'ia_building_project_type',     (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_building_project_type),
    'ia_who_gets_paid',             (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_who_gets_paid),
    'ia_tax_classification_type',   (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_tax_classification_type),
    'ia_has_combustion_appliances', (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_has_combustion_appliances),
    'ia_venting_test',              (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_venting_test),
    'ia_spilling_test',             (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_spilling_test),
    'ia_gas_leak_test',             (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_gas_leak_test),
    'ia_undiluted_co_test',         (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_undiluted_co_test),
    'ia_ambient_co_test',           (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_ambient_co_test),
    'ia_mold_moisture',             (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_mold_moisture),
    'ia_roof_condition',            (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_roof_condition),
    'ia_ashrae_62_2',               (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_ashrae_62_2),
    'ia_drainage_condition',        (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_drainage_condition),
    'ia_disclosed_to_homeowner',    (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_disclosed_to_homeowner),
    'ia_modeling_software',         (SELECT picklist_value FROM public.picklist_values WHERE id = ia.ia_modeling_software),

    'has_support_contractor',       CASE WHEN ia.ia_has_support_contractor IS TRUE THEN 'Yes'
                                         WHEN ia.ia_has_support_contractor IS FALSE THEN 'No' END,

    'contractor_business_name',      ca.account_name,
    'contractor_contact_first_name', cc.contact_first_name,
    'contractor_contact_last_name',  cc.contact_last_name,
    'contractor_email',              cc.contact_email,
    'contractor_phone',              cc.contact_phone,
    'contractor_street',             ca.billing_street,
    'contractor_city',               ca.billing_city,
    'contractor_state',              ca.billing_state,
    'contractor_zip',                ca.billing_zip,

    'business_entity_name',          COALESCE(NULLIF(BTRIM(pr.property_hud_owner_org),''), ca.account_name),
    'signer_contact_name',           NULLIF(BTRIM(COALESCE(sc.contact_first_name,'') || ' ' || COALESCE(sc.contact_last_name,'')), ''),
    'signer_contact_email',          sc.contact_email,
    'signer_contact_phone',          sc.contact_phone,

    'installation_street',           pr.property_street,
    'installation_city',             pr.property_city,
    'installation_state',            pr.property_state,
    'installation_zip',              pr.property_zip,

    'ia_total_project_cost',         ia.ia_total_project_cost::text,
    'ia_tax_identification_fein',    ia.ia_tax_identification_fein,
    'payment_mailing_street',        ia.ia_payment_mailing_street,
    'payment_mailing_city',          ia.ia_payment_mailing_city,
    'payment_mailing_state',         ia.ia_payment_mailing_state,
    'payment_mailing_zip',           ia.ia_payment_mailing_zip,

    -- The configurable list. The IQ code IS the building's LEA number, read
    -- live from the building rather than copied onto the application.
    'ia_unit_number',                ia.ia_unit_number,
    'iq_code',                       bl.ira_confirmation_code_lea
  ));
END $function$;

REVOKE ALL ON FUNCTION public.build_wi_ira_payment_request_form_prefill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_payment_request_form_prefill(uuid) TO authenticated, service_role;
