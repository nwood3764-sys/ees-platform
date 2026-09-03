-- The HEAR Project Reservation is mapped from the HEAR form itself.
--
-- 20260903001315 created the HEAR target by COPYING the HOMES field map,
-- reasoning that the two branches were one form. They are not: the HEAR
-- submittal is Jotform 251176242544858, a different form with its own question
-- ids, and 20260903005141 repointed the target at it. The copied map was then
-- 23 parameters belonging to a form that is no longer being opened -- it would
-- have filled almost nothing, silently.
--
-- Nicholas supplied the HEAR form's HTML, so this map is read off the form
-- rather than inferred. Every parameter below is the question's UNIQUE NAME
-- taken verbatim from its own input, and the option strings on the radio
-- questions were compared against the picklists LEAP stores.
--
-- Three things the form itself settled, each of which would have been a wrong
-- guess:
--
--   · The contractor questions are NOT the HOMES names. HEAR asks
--     `contractorBusiness` and `contractorContact`, where HOMES asks
--     `primaryContractor28` and `primaryContractor`. The address, email and
--     phone (primaryContractor116, email45, phoneNumber46) DO coincide, which
--     is exactly why a copied map looks plausible and fails in parts.
--   · There is no Support Contractor question anywhere on the HEAR form -- the
--     phrase does not occur in the HTML once. So `willA78` is dropped rather
--     than carried over. LEAP still records a support contractor on the HEAR
--     enrollment; the form simply never asks.
--   · The money is per-programme: HEAR asks `totalIra483` (Total IRA HEAR
--     Costs) and `totalIra536` (Rebate Requested) plus Equipment & Materials
--     and Installation Costs, where HOMES asks totalProject/totalIra/
--     totalIra384. Sending a HOMES parameter here fills nothing.
--
-- One question is deliberately NOT mapped, and cannot be: "Estimated project
-- completion date" is q148, a Jotform control_widget rendered in its own
-- IFRAME (customFieldFrame_148). URL prefill cannot reach inside a widget --
-- that is a property of Jotform, not a gap in this map. The date is on the
-- enrollment and has to be typed once on the form.

BEGIN;

-- ── 1. Retire the copied map ─────────────────────────────────────────────
UPDATE public.external_form_field_map m
   SET efm_is_deleted = true,
       efm_deleted_at = now(),
       efm_deletion_reason = 'Copied from the HOMES form (250306438751960). The HEAR reservation opens 251176242544858, whose question names differ.'
  FROM public.external_form_targets t
 WHERE t.id = m.efm_target_id
   AND t.eft_key = 'wi_ira_mf_hear_project_reservation'
   AND m.efm_is_deleted IS NOT TRUE;

-- ── 2. The HEAR form's own parameters ────────────────────────────────────
INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
   efm_option_value_map, efm_field_label, efm_sort_order, efm_is_active, efm_is_required,
   efm_owner, efm_created_by, efm_updated_by, is_seed_data)
SELECT '', tgt.id, v.leap, v.param, v.xform, v.ovm, v.label, v.ord, true, v.req,
       tgt.eft_owner, tgt.eft_owner, tgt.eft_owner, true
FROM (SELECT id, eft_owner FROM public.external_form_targets
       WHERE eft_key='wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE) tgt,
LATERAL (VALUES
  ('ia_application_for','imApplying',NULL::text,'{}'::jsonb,'I''m Applying for a(n)',10,true),
  ('ia_building_type','buildingType255',NULL,'{}'::jsonb,'Building Type',20,true),
  ('ia_building_project_type','buildingProject261',NULL,'{}'::jsonb,'Building Project Type',30,true),
  ('contractor_business_name','contractorBusiness',NULL,'{}'::jsonb,'Contractor Business Name',40,true),
  ('contractor_contact_first_name','contractorContact[first]',NULL,'{}'::jsonb,'Contractor Contact First Name',50,true),
  ('contractor_contact_last_name','contractorContact[last]',NULL,'{}'::jsonb,'Contractor Contact Last Name',60,true),
  ('contractor_email','email45',NULL,'{}'::jsonb,'Contractor Email',70,true),
  ('contractor_phone','phoneNumber46[full]',NULL,'{}'::jsonb,'Contractor Phone Number',80,true),
  ('contractor_street','primaryContractor116[addr_line1]',NULL,'{}'::jsonb,'Contractor Address',90,true),
  ('contractor_city','primaryContractor116[city]',NULL,'{}'::jsonb,'Contractor City',100,true),
  ('contractor_state','primaryContractor116[state]','state_2letter','{}'::jsonb,'Contractor State',110,true),
  ('contractor_zip','primaryContractor116[postal]',NULL,'{}'::jsonb,'Contractor ZIP',120,true),
  ('business_entity_name','businessEntity268',NULL,'{}'::jsonb,'Business Entity Name',130,true),
  ('signer_contact_name','contactName',NULL,'{}'::jsonb,'Contact Name',140,true),
  ('signer_contact_email','email',NULL,'{}'::jsonb,'Email',150,true),
  ('signer_contact_phone','phoneNumber[full]',NULL,'{}'::jsonb,'Phone Number',160,true),
  ('installation_street','installationAddress[addr_line1]',NULL,'{}'::jsonb,'Installation Address',170,true),
  ('installation_city','installationAddress[city]',NULL,'{}'::jsonb,'Installation City',180,true),
  ('installation_state','installationAddress[state]',NULL,'{}'::jsonb,'Installation State',190,true),
  ('installation_zip','installationAddress[postal]',NULL,'{}'::jsonb,'Installation ZIP',200,true),
  ('building_owner_name','buildingOwner[first]',NULL,'{}'::jsonb,'Building Owner Name',210,true),
  ('total_units_in_building','totalNumber164',NULL,'{}'::jsonb,'Total Number of Units in the building?',220,true),
  ('occupied_units','numberOf284',NULL,'{}'::jsonb,'Number of Occupied Units',230,true),
  ('conditioned_floor_area','conditionedFloor444',NULL,'{}'::jsonb,'Conditioned Floor Area of Multifamily Building (sq ft)',240,true),
  ('year_built','yearThe',NULL,'{}'::jsonb,'Year the Building was Built',250,true),
  ('number_of_bedrooms','multifamilyNumber',NULL,'{}'::jsonb,'Multifamily number of bedrooms',260,true),
  -- The form spells it "Low- Income", with the space. LEAP stores "Low-Income".
  -- A radio whose value does not match the option string exactly is simply not
  -- selected, so the difference is carried here rather than in the data.
  ('income_level','whichIncome',NULL,'{"Low-Income":"Low- Income"}'::jsonb,'Which income level is your customer approved at?',270,true),
  ('iq_code','incomequalifiedConfirmation',NULL,'{}'::jsonb,'Income-Qualified Confirmation Code',280,true),
  ('energy_data_sharing_permission','permissionTo',NULL,'{}'::jsonb,'Permission to share energy data with the State and DOE',290,true),
  ('electric_provider','electricProvider',NULL,'{}'::jsonb,'Electric Provider',300,true),
  ('electric_account_number','electricAccount',NULL,'{}'::jsonb,'Electric Account Number',310,true),
  ('heating_fuel_type','howIs',NULL,'{}'::jsonb,'How is this building heated?',320,true),
  -- A checkbox list: one parameter, one entry per measure.
  ('work_measures','whatWork346[]',NULL,'{}'::jsonb,'What work will be completed?',330,true),
  ('equipment_and_materials_costs','equipmentampamp',NULL,'{}'::jsonb,'Equipment & Materials Costs',340,true),
  ('installation_costs','installationCosts',NULL,'{}'::jsonb,'Installation Costs',350,true),
  ('total_ira_hear_cost','totalIra483',NULL,'{}'::jsonb,'Total IRA HEAR Costs',360,true),
  ('total_ira_hear_rebate_requested','totalIra536',NULL,'{}'::jsonb,'Total IRA HEAR Rebate Requested',370,true),
  ('submitted_by_first_name','whoIs[first]',NULL,'{}'::jsonb,'Who is submitting this form? (First)',380,true),
  ('submitted_by_last_name','whoIs[last]',NULL,'{}'::jsonb,'Who is submitting this form? (Last)',390,true),
  ('who_gets_paid','whoGets',NULL,'{}'::jsonb,'Who gets paid?',400,false),
  ('tax_classification','taxClassification',NULL,'{}'::jsonb,'Tax Classification',410,false),
  ('tax_identification_fein','taxIdentification',NULL,'{}'::jsonb,'Tax Identification FEIN',420,false),
  ('payment_mailing_street','mailingAddress264[addr_line1]',NULL,'{}'::jsonb,'Mailing Address',430,false),
  ('payment_mailing_city','mailingAddress264[city]',NULL,'{}'::jsonb,'Mailing City',440,false),
  ('payment_mailing_state','mailingAddress264[state]','state_2letter','{}'::jsonb,'Mailing State',450,false),
  ('payment_mailing_zip','mailingAddress264[postal]',NULL,'{}'::jsonb,'Mailing ZIP',460,false)
) AS v(leap, param, xform, ovm, label, ord, req);

-- ── 3. The resolver reads what the HEAR layout already names ─────────────
-- Every source below is the column the HEAR Project Reservation page layout
-- binds that same question to, so the form receives what a person reads on the
-- record -- not a second opinion about where a value lives.
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
    -- The installation contact is the signer lookup on this layout, falling
    -- back to the typed-in contact for a record saved before that lookup
    -- existed.
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
    -- ("WI-WE-ENERGIES"). The radio questions above take the stored value,
    -- because those must match an option string exactly.
    'electric_provider',             (SELECT COALESCE(NULLIF(BTRIM(COALESCE(picklist_label,'')),''), picklist_value)
                                        FROM public.picklist_values WHERE id = bl.building_electric_utility),
    'electric_account_number',       bl.building_electric_account_number,
    'heating_fuel_type',             (SELECT picklist_value FROM public.picklist_values WHERE id = bl.building_heating_fuel_type),
    'work_measures',                 en.enrollment_work_measures,
    'equipment_and_materials_costs', en.enrollment_equipment_and_materials_costs,
    'installation_costs',            en.enrollment_installation_costs,
    'total_ira_hear_cost',           en.enrollment_total_ira_hear_cost,
    'total_ira_hear_rebate_requested', en.enrollment_requested_incentive_amount,
    'submitted_by_first_name',       su.user_first_name,
    'submitted_by_last_name',        su.user_last_name,
    'who_gets_paid',                 (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_payee),
    'tax_classification',            (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_tax_classification),
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

-- ── 4. Assertions ────────────────────────────────────────────────────────
DO $assert$
DECLARE
  v_target uuid;
  v_count int;
  v_enr uuid;
  v_payload jsonb;
  v_unfilled text;
BEGIN
  SELECT id INTO v_target FROM public.external_form_targets
   WHERE eft_key='wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE;

  SELECT count(*) INTO v_count FROM public.external_form_field_map
   WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE;
  IF v_count <> 46 THEN
    RAISE EXCEPTION 'The HEAR map should carry 46 parameters, it carries %', v_count;
  END IF;

  -- The HOMES parameters must be GONE. Leaving one behind is the failure this
  -- migration exists to undo, and it is invisible on the form.
  IF EXISTS (SELECT 1 FROM public.external_form_field_map
              WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE
                AND efm_external_param IN ('primaryContractor28','primaryContractor[first]',
                                           'primaryContractor[last]','willA78','totalProject',
                                           'totalIra','totalIra384')) THEN
    RAISE EXCEPTION 'A HOMES-form parameter is still live on the HEAR map.';
  END IF;

  -- Every mapped payload key has to be one the resolver can actually produce.
  SELECT e.id INTO v_enr
    FROM public.enrollments e
    JOIN public.picklist_values pv ON pv.id = e.enrollment_record_type
   WHERE pv.picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation'
     AND e.enrollment_is_deleted IS NOT TRUE
   ORDER BY e.enrollment_created_at DESC LIMIT 1;
  IF v_enr IS NOT NULL THEN
    v_payload := public.build_wi_ira_hear_project_reservation_form_prefill(v_enr);
    SELECT string_agg(m.efm_leap_field, ', ') INTO v_unfilled
      FROM public.external_form_field_map m
     WHERE m.efm_target_id = v_target AND m.efm_is_deleted IS NOT TRUE
       AND NOT (v_payload ? m.efm_leap_field)
       -- FEIN is genuinely blank on the contractor account today; that is a
       -- data gap on the record, not a broken map.
       AND m.efm_leap_field <> 'tax_identification_fein';
    IF v_unfilled IS NOT NULL THEN
      RAISE EXCEPTION 'These mapped fields are not produced by the resolver: %', v_unfilled;
    END IF;
  END IF;
END $assert$;

COMMIT;
