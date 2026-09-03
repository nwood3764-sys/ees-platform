-- "Is a Social Security Number Used as Your Tax Identification Number?" is
-- always No.
--
-- Nicholas: "we're never going to use that. It's always EIN. We only work with
-- businesses."
--
-- q461 (`isA`) is required on the HEAR submittal and hidden until its branch
-- opens, which is why the saved HTML could not say whether a Project
-- Reservation is asked it. That question is now moot: the answer does not
-- depend on the branch, the record, or the programme -- it is a fact about who
-- EES contracts with. So it is answered unconditionally, and if the reservation
-- branch never shows the question the parameter is simply ignored.
--
-- IT IS A LITERAL, NOT A COLUMN, on purpose. A column would ask a person, on
-- every enrollment, a question that has one answer -- and would eventually be
-- left blank on the one that mattered. This is the same shape as
-- `ia_application_for`, which is 'Project Reservation' in this resolver for the
-- same reason: the record type decides it, not the user. If EES ever pays a
-- sole proprietor on an SSN, this becomes a column then, with a default of No.
--
-- 'No' is the form's own option string, verbatim (q461 offers exactly Yes / No).
-- A radio whose value does not match an option character for character is not
-- selected at all.
--
-- The consequence worth naming: the tax identity LEAP sends is therefore always
-- the FEIN, from accounts.account_fein -- which is EMPTY on Sealed Inc and both
-- EES accounts today. That is now the one answer the HEAR form asks for and
-- does not receive.

INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
   efm_option_value_map, efm_field_label, efm_sort_order, efm_is_active, efm_is_required,
   efm_url_prefillable, efm_owner, efm_created_by, efm_updated_by, is_seed_data)
SELECT '', tgt.id, 'ssn_used_as_tax_id', 'isA', NULL, '{}'::jsonb,
       'Is a Social Security Number Used as Your Tax Identification Number?', 415, true, false, true,
       tgt.eft_owner, tgt.eft_owner, tgt.eft_owner, true
FROM (SELECT id, eft_owner FROM public.external_form_targets
       WHERE eft_key='wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE) tgt
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_field_map m
   WHERE m.efm_target_id = tgt.id AND m.efm_is_deleted IS NOT TRUE
     AND m.efm_leap_field = 'ssn_used_as_tax_id');

CREATE OR REPLACE FUNCTION public.build_wi_ira_hear_project_reservation_form_prefill(p_enrollment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  en public.enrollments%ROWTYPE;
  ca public.accounts%ROWTYPE;
  cc public.contacts%ROWTYPE;
  sc public.contacts%ROWTYPE;
  pr public.properties%ROWTYPE;
  bl public.buildings%ROWTYPE;
  su public.users%ROWTYPE;
  rt text;
  v_heat text;
BEGIN
  IF p_enrollment_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT e.* INTO en FROM public.enrollments e WHERE e.id = p_enrollment_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT picklist_value INTO rt FROM public.picklist_values WHERE id = en.enrollment_record_type;
  IF rt IS DISTINCT FROM 'WI-IRA-MF-HEAR-Project-Reservation' THEN RETURN '{}'::jsonb; END IF;

  IF en.enrollment_contractor_account_id IS NOT NULL THEN
    SELECT x.* INTO ca FROM public.accounts x WHERE x.id = en.enrollment_contractor_account_id;
  END IF;
  IF en.enrollment_contractor_contact_id IS NOT NULL THEN
    SELECT x.* INTO cc FROM public.contacts x WHERE x.id = en.enrollment_contractor_contact_id;
  END IF;
  IF en.enrollment_signer_contact_id IS NOT NULL THEN
    SELECT x.* INTO sc FROM public.contacts x WHERE x.id = en.enrollment_signer_contact_id;
  END IF;
  IF en.enrollment_submitted_by IS NOT NULL THEN
    SELECT x.* INTO su FROM public.users x WHERE x.id = en.enrollment_submitted_by;
  END IF;
  IF en.property_id IS NOT NULL THEN SELECT x.* INTO pr FROM public.properties x WHERE x.id = en.property_id; END IF;
  IF en.building_id IS NOT NULL THEN SELECT x.* INTO bl FROM public.buildings x WHERE x.id = en.building_id; END IF;

  SELECT picklist_value INTO v_heat FROM public.picklist_values WHERE id = bl.building_heating_fuel_type;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'ia_application_for',            'Project Reservation',
    'ia_building_type',              (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_building_type),
    'ia_building_project_type',      (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_building_project_type),
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
    'building_owner_name',           public.resolve_property_owner_name(en.property_id),
    'signer_contact_name',           COALESCE(NULLIF(BTRIM(COALESCE(sc.contact_name,'')), ''),
                                              NULLIF(BTRIM(COALESCE(en.enrollment_contact_name,'')), '')),
    'signer_contact_email',          COALESCE(sc.contact_email, en.enrollment_contact_email),
    'signer_contact_phone',          COALESCE(sc.contact_phone, en.enrollment_contact_phone),
    'installation_street',           pr.property_street,
    'installation_city',             pr.property_city,
    'installation_state',            pr.property_state,
    'installation_zip',              pr.property_zip,
    'iq_code',                       bl.ira_confirmation_code_lea
  ) || jsonb_strip_nulls(jsonb_build_object(
    'total_units_in_building',       bl.building_total_units,
    'occupied_units',                en.enrollment_occupied_units,
    'conditioned_floor_area',        bl.building_square_footage,
    'year_built',                    bl.building_year_built,
    'number_of_bedrooms',            bl.building_number_of_bedrooms,
    'income_level',                  (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_income_level),
    'energy_data_sharing_permission',(SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_energy_data_sharing_permission),
    -- Electric Provider is a free-text box on the form, so it takes the utility's
    -- READABLE name ("We Energies"), not the picklist's stored code
    -- ("WI-WE-ENERGIES"). The radio questions take the stored value, because
    -- those must match an option string exactly.
    'electric_provider',             (SELECT COALESCE(NULLIF(BTRIM(COALESCE(picklist_label,'')),''), picklist_value)
                                        FROM public.picklist_values WHERE id = bl.building_electric_utility),
    'electric_account_number',       bl.building_electric_account_number,
    'heating_fuel_type',             v_heat,
    -- Asked only of a gas building, so answered only for one. An electric
    -- building's gas utility is legitimately "None - Building Has No Natural Gas
    -- Service", which is the right answer to a different question.
    'gas_provider',                  CASE WHEN v_heat = 'Natural Gas'
                                          THEN (SELECT COALESCE(NULLIF(BTRIM(COALESCE(picklist_label,'')),''), picklist_value)
                                                  FROM public.picklist_values WHERE id = bl.building_gas_utility) END,
    'gas_account_number',            CASE WHEN v_heat = 'Natural Gas' THEN bl.building_gas_account_number END,
    'other_heating_provider',        CASE WHEN v_heat IN ('Propane','Fuel Oil','Wood')
                                          THEN NULLIF(BTRIM(COALESCE(bl.building_heating_fuel_provider,'')), '') END,
    'other_heating_account_number',  CASE WHEN v_heat IN ('Propane','Fuel Oil','Wood')
                                          THEN bl.building_account_number END,
    'work_measures',                 en.enrollment_work_measures,
    -- Sent as YYYY-MM-DD; the map's date_mmddyyyy transform turns it into the
    -- 09/25/2026 the widget's own dateFormat setting asks for. It is NOT sent in
    -- the URL (the widget overwrites it) -- it is handed to the person.
    'estimated_completion_date',     en.enrollment_estimated_completion_date,
    'equipment_and_materials_costs', en.enrollment_equipment_and_materials_costs,
    'installation_costs',            en.enrollment_installation_costs,
    'total_ira_hear_cost',           en.enrollment_total_ira_hear_cost,
    'total_ira_hear_rebate_requested', en.enrollment_requested_incentive_amount,
    'submitted_by_first_name',       su.user_first_name,
    'submitted_by_last_name',        su.user_last_name,
    'who_gets_paid',                 (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_payee),
    'tax_classification',            (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_tax_classification),
    -- EES contracts with businesses, so the tax identity is always an EIN and
    -- this question is always No. Not a column: it has one answer, and a column
    -- would eventually be left blank on the filing that mattered.
    'ssn_used_as_tax_id',            'No',
    'tax_identification_fein',       NULLIF(BTRIM(COALESCE(ca.account_fein,'')), ''),
    'payment_mailing_street',        en.enrollment_payment_address_line1,
    'payment_mailing_city',          en.enrollment_payment_city,
    'payment_mailing_state',         en.enrollment_payment_state,
    'payment_mailing_zip',           en.enrollment_payment_zip
  )));
END $function$;

REVOKE ALL ON FUNCTION public.build_wi_ira_hear_project_reservation_form_prefill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_hear_project_reservation_form_prefill(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_target uuid; v_count int; v_enr uuid; v_p jsonb;
BEGIN
  SELECT id INTO v_target FROM public.external_form_targets
   WHERE eft_key='wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE;

  SELECT count(*) INTO v_count FROM public.external_form_field_map
   WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE;
  IF v_count <> 52 THEN
    RAISE EXCEPTION 'The HEAR map should carry 52 parameters, it carries %', v_count;
  END IF;

  SELECT e.id INTO v_enr FROM public.enrollments e
    JOIN public.picklist_values pv ON pv.id = e.enrollment_record_type
   WHERE pv.picklist_value='WI-IRA-MF-HEAR-Project-Reservation' AND e.enrollment_is_deleted IS NOT TRUE
   ORDER BY e.enrollment_created_at DESC LIMIT 1;
  IF v_enr IS NOT NULL THEN
    v_p := public.build_wi_ira_hear_project_reservation_form_prefill(v_enr);
    -- 'No' exactly: the form's radio offers Yes / No, and a value that is not
    -- one of those character for character selects nothing.
    IF (v_p->>'ssn_used_as_tax_id') IS DISTINCT FROM 'No' THEN
      RAISE EXCEPTION 'Expected No for the SSN question, got %', v_p->>'ssn_used_as_tax_id';
    END IF;
    -- And it must never depend on a record being filled in.
    IF NOT (public.build_wi_ira_hear_project_reservation_form_prefill(v_enr) ? 'ssn_used_as_tax_id') THEN
      RAISE EXCEPTION 'The SSN answer is conditional on something — it must always be sent.';
    END IF;
  END IF;
END $assert$;
