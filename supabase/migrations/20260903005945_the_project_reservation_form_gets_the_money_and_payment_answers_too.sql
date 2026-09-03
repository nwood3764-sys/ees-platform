-- Why the Project Reservation Jotform came back half empty.
--
-- The reservation field map carried 23 parameters. The form asks for far more
-- than that, so every question the map never named arrived blank -- not because
-- LEAP had no value for it (it does, on the enrollment) but because nobody had
-- ever told LEAP what that question is called.
--
-- A Jotform parameter is the question's UNIQUE NAME, which cannot be guessed:
-- a wrong guess fills nothing and looks exactly like a field that was never
-- mapped. So the names here are not invented. The Project Reservation and the
-- Final Installation Payment Request are two branches of the SAME Jotform
-- (250306438751960) -- both targets already point at that one URL -- so the 50
-- parameters proved out on the payment-request map are the same form's names.
-- The 11 added below are taken verbatim from those rows; only the LEAP column
-- feeding each one changes, because the source record is the enrollment.
--
-- What is still NOT mapped, and why it stays that way: the Support Contractor
-- block, the building metrics (units, occupied units, square footage, floors,
-- year built), the income level, the utility questions, the work measures, the
-- estimated completion date and the energy-data-sharing permission. Those
-- questions appear only on the reservation branch, so no verified parameter
-- name for them exists anywhere in this database, and this sandbox cannot
-- reach jotform.com to read them. Guessing them would put rows in the map that
-- silently fill nothing -- worse than an honest gap, because the map would then
-- claim coverage it does not have. They need the form's saved HTML.

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
  ) || jsonb_strip_nulls(jsonb_build_object(
    'ia_total_project_cost',                en.enrollment_total_project_cost,
    'ia_total_ira_homes_cost',              en.enrollment_total_ira_homes_cost,
    'ia_total_ira_homes_rebate_requested',  en.enrollment_requested_incentive_amount,
    'ia_modeled_savings_predicted',         en.enrollment_modeled_savings,
    'ia_modeling_software',                 (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_modeling_software),
    'ia_who_gets_paid',                     (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_payee),
    'ia_tax_classification_type',           (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_tax_classification),
    'ia_tax_identification_fein',           NULLIF(BTRIM(COALESCE(ca.account_fein,'')), ''),
    'payment_mailing_street',               en.enrollment_payment_address_line1,
    'payment_mailing_city',                 en.enrollment_payment_city,
    'payment_mailing_state',                en.enrollment_payment_state,
    'payment_mailing_zip',                  en.enrollment_payment_zip
  )));
END $fn$;

REVOKE ALL ON FUNCTION public.build_wi_ira_project_reservation_form_prefill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_project_reservation_form_prefill(uuid) TO anon, authenticated, service_role;

INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
   efm_option_value_map, efm_field_label, efm_sort_order, efm_is_active, efm_is_required,
   efm_owner, efm_created_by, efm_updated_by, is_seed_data)
SELECT '', tgt.id, v.leap, v.param, v.xform, '{}'::jsonb, v.label, v.ord, true, v.req,
       tgt.eft_owner, tgt.eft_owner, tgt.eft_owner, true
FROM (SELECT id, eft_owner FROM public.external_form_targets
       WHERE eft_key='wi_ira_mf_homes_project_reservation' AND eft_is_deleted IS NOT TRUE) tgt,
LATERAL (VALUES
  ('ia_total_project_cost','totalProject',NULL::text,'Total Project Cost',240,false),
  ('ia_total_ira_homes_rebate_requested','totalIra',NULL,'Total IRA HOMES Rebate Requested',250,false),
  ('ia_total_ira_homes_cost','totalIra384',NULL,'Total IRA HOMES Cost',260,false),
  ('ia_modeled_savings_predicted','modeledSavings',NULL,'Modeled Savings Predicted',270,false),
  ('ia_modeling_software','modelingSoftware',NULL,'Modeling Software Used',280,false),
  ('ia_who_gets_paid','whoGets',NULL,'Who gets paid?',290,false),
  ('ia_tax_classification_type','taxClassification',NULL,'Tax Classification',300,false),
  ('ia_tax_identification_fein','taxIdentification',NULL,'Tax Identification FEIN',310,false),
  ('payment_mailing_street','mailingAddress264[addr_line1]',NULL,'Mailing Address',320,false),
  ('payment_mailing_city','mailingAddress264[city]',NULL,'Mailing City',330,false),
  ('payment_mailing_state','mailingAddress264[state]','state_2letter','Mailing State',340,false),
  ('payment_mailing_zip','mailingAddress264[postal]',NULL,'Mailing ZIP',350,false)
) AS v(leap, param, xform, label, ord, req)
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_field_map m
   WHERE m.efm_target_id = tgt.id AND m.efm_is_deleted IS NOT TRUE
     AND m.efm_external_param = v.param);

DO $assert$
DECLARE
  v_count int;
  v_payload jsonb;
  v_enr uuid;
  v_missing text;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.external_form_field_map m
    JOIN public.external_form_targets t ON t.id = m.efm_target_id
   WHERE t.eft_key='wi_ira_mf_homes_project_reservation' AND m.efm_is_deleted IS NOT TRUE;
  IF v_count <> 35 THEN
    RAISE EXCEPTION 'The Project Reservation map should carry 35 parameters, it carries %', v_count;
  END IF;

  SELECT string_agg(m.efm_external_param, ', ') INTO v_missing
    FROM public.external_form_field_map m
    JOIN public.external_form_targets t ON t.id = m.efm_target_id
   WHERE t.eft_key='wi_ira_mf_homes_project_reservation' AND m.efm_is_deleted IS NOT TRUE
     AND m.efm_sort_order >= 240
     AND NOT EXISTS (
       SELECT 1 FROM public.external_form_field_map m2
        JOIN public.external_form_targets t2 ON t2.id = m2.efm_target_id
       WHERE t2.eft_key='wi_ira_mf_homes_project_payment_request'
         AND m2.efm_is_deleted IS NOT TRUE
         AND m2.efm_external_param = m.efm_external_param);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'These parameters are not proved out on the same form: %', v_missing;
  END IF;

  SELECT e.id INTO v_enr
    FROM public.enrollments e
    JOIN public.picklist_values pv ON pv.id = e.enrollment_record_type
   WHERE pv.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation'
     AND e.enrollment_is_deleted IS NOT TRUE
     AND e.enrollment_total_project_cost IS NOT NULL
   ORDER BY e.enrollment_created_at DESC LIMIT 1;
  IF v_enr IS NOT NULL THEN
    v_payload := public.build_wi_ira_project_reservation_form_prefill(v_enr);
    IF NOT (v_payload ? 'ia_total_project_cost' AND v_payload ? 'ia_who_gets_paid') THEN
      RAISE EXCEPTION 'The resolver still does not emit the new keys: %', v_payload;
    END IF;
  END IF;
END $assert$;
