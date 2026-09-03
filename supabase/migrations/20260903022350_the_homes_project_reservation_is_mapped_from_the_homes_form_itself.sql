-- The HOMES Project Reservation is mapped from the HOMES form itself.
--
-- Nicholas supplied Jotform 250306438751960 as HTML. First thing checked, since
-- he suspected the form had changed: all 25 parameters the map already used are
-- STILL on it. Nothing regressed. What was blank was never mapped -- the map
-- named 35 of the form's 144 questions.
--
-- Everything below is the question's UNIQUE NAME read off its own input, and
-- every radio/checkbox value was compared against the picklists LEAP stores.
--
-- FOUR THINGS THE FORM SETTLED THAT COULD ONLY HAVE BEEN GUESSED WRONG:
--
-- 1. The Support Contractor block is a CONFIGURABLE LIST WIDGET (q156,
--    `typeA156`), not five text boxes. Its own settings spell the columns:
--    "*Support Contractor Business Name: text / Support Contractor Contact
--    Name: text / *Support Contractor Full Address: text / Support Contractor
--    Phone Number: text / Support Contractor Email: text". A widget renders in
--    its own iframe and URL prefill cannot reach inside one -- the same wall the
--    HEAR completion date hit. So those five are mapped as HAND-OVER fields:
--    resolved, kept out of the URL, and shown to the person to type. Five rows
--    share the one parameter because they are five columns of one widget; they
--    never reach the query string, so the repeat is harmless and honest.
--
-- 2. The Unit Number / IQ Code list is ALSO a Configurable List widget (q411).
--    Deliberately left alone: Nicholas ruled whole-building, one LEA number,
--    which is the standalone Income-Qualified Confirmation Code question the
--    map already fills from the building. No per-unit enumeration.
--
-- 3. The completion date here is NOT the widget the HEAR form uses. q403
--    `estimatedCompletion` is Jotform's NATIVE date control -- three inputs,
--    [month]/[day]/[year] -- so it prefills properly. Its own hint asks for
--    "2 digit month, 2 digit day, 4 digit year", which is why this needs the new
--    date_month_2 / date_day_2 transforms rather than the Formstack pair that
--    drops the leading zero. (q148 and q281 ARE Date Picker widgets, both
--    optional, both left alone.)
--
-- 4. There are TWO measure checklists and the enrollment already spans both:
--    q275 `whatWork` carries the envelope measures (Air Sealing, Ceiling
--    Insulation, ...) and q342 `whatWork342` the HVAC ones (Replace HVAC PSZ HP
--    + DOAS, Water Saving Measures, ...). Live records hold values from both.
--    The same array is therefore sent to BOTH questions: a checkbox value that
--    is not an option on a list is simply not ticked, so each measure lands in
--    the list that owns it and nothing lands twice.
--
-- Not on this form at all, unlike HEAR: the energy-data-sharing permission. Not
-- mapped, because it does not exist here.

INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
   efm_option_value_map, efm_field_label, efm_sort_order, efm_is_active, efm_is_required,
   efm_url_prefillable, efm_owner, efm_created_by, efm_updated_by, is_seed_data)
SELECT '', tgt.id, v.leap, v.param, v.xform, v.ovm, v.label, v.ord, true, v.req, v.fillable,
       tgt.eft_owner, tgt.eft_owner, tgt.eft_owner, true
FROM (SELECT id, eft_owner FROM public.external_form_targets
       WHERE eft_key='wi_ira_mf_homes_project_reservation' AND eft_is_deleted IS NOT TRUE) tgt,
LATERAL (VALUES
  ('total_units_in_building','totalNumber164',NULL::text,'{}'::jsonb,'Total Number of Units',360,true,true),
  ('occupied_units','totalNumber',NULL,'{}'::jsonb,'Total Number of Occupied Units',362,true,true),
  ('building_square_footage','totalBuilding',NULL,'{}'::jsonb,'Total Building Square Footage',364,true,true),
  ('total_floors','totalFloors',NULL,'{}'::jsonb,'Total Floors in Building',366,true,true),
  ('year_built','yearThe',NULL,'{}'::jsonb,'Year the Building was Built',368,true,true),
  ('income_level','whichIncome',NULL,'{"Low-Income":"Low- Income"}'::jsonb,'Which income level is your customer approved at?',370,true,true),
  ('electric_provider','electricProvider',NULL,'{}'::jsonb,'Electric Provider',372,true,true),
  ('electric_account_number','electricAccount',NULL,'{}'::jsonb,'Electric Account Number',374,true,true),
  ('heating_fuel_type','howIs',NULL,'{}'::jsonb,'How is this building heated?',376,true,true),
  ('gas_provider','naturalGas',NULL,'{}'::jsonb,'Natural Gas Provider',378,false,true),
  ('gas_account_number','naturalGas107',NULL,'{}'::jsonb,'Natural Gas Account Number',380,false,true),
  ('other_heating_provider','otherHeating',NULL,'{}'::jsonb,'Other Heating Fuel Provider',382,false,true),
  ('other_heating_account_number','otherAccount109',NULL,'{}'::jsonb,'Other Account Number',384,false,true),
  ('work_measures','whatWork[]',NULL,'{}'::jsonb,'What work will be completed?',386,false,true),
  ('work_measures','whatWork342[]',NULL,'{}'::jsonb,'What work will be completed? (HVAC)',388,false,true),
  ('estimated_completion_date','estimatedCompletion[month]','date_month_2','{}'::jsonb,'Estimated Completion Date',390,true,true),
  ('estimated_completion_date','estimatedCompletion[day]','date_day_2','{}'::jsonb,'Estimated Completion Date',391,true,true),
  ('estimated_completion_date','estimatedCompletion[year]','date_year','{}'::jsonb,'Estimated Completion Date',392,true,true),
  ('submitted_by_first_name','whoIs[first]',NULL,'{}'::jsonb,'Who is submitting this form? (First)',394,true,true),
  ('submitted_by_last_name','whoIs[last]',NULL,'{}'::jsonb,'Who is submitting this form? (Last)',396,true,true),
  ('ssn_used_as_tax_id','isA',NULL,'{}'::jsonb,'Is a Social Security Number Used as Your Tax Identification Number?',398,false,true),
  ('support_contractor_business_name','typeA156',NULL,'{}'::jsonb,'Support Contractor Business Name',400,false,false),
  ('support_contractor_contact_name','typeA156',NULL,'{}'::jsonb,'Support Contractor Contact Name',401,false,false),
  ('support_contractor_full_address','typeA156',NULL,'{}'::jsonb,'Support Contractor Full Address',402,false,false),
  ('support_contractor_phone','typeA156',NULL,'{}'::jsonb,'Support Contractor Phone Number',403,false,false),
  ('support_contractor_email','typeA156',NULL,'{}'::jsonb,'Support Contractor Email',404,false,false)
) AS v(leap, param, xform, ovm, label, ord, req, fillable)
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_field_map m
   WHERE m.efm_target_id = tgt.id AND m.efm_is_deleted IS NOT TRUE
     AND m.efm_external_param = v.param AND m.efm_leap_field = v.leap);

CREATE OR REPLACE FUNCTION public.build_wi_ira_project_reservation_form_prefill(p_enrollment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_catalog'
AS $fn$
DECLARE
  en public.enrollments%ROWTYPE;
  ca public.accounts%ROWTYPE;
  cc public.contacts%ROWTYPE;
  sa public.accounts%ROWTYPE;
  scc public.contacts%ROWTYPE;
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
  IF rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-Project-Reservation' THEN RETURN '{}'::jsonb; END IF;

  IF en.enrollment_contractor_account_id IS NOT NULL THEN
    SELECT x.* INTO ca FROM public.accounts x WHERE x.id = en.enrollment_contractor_account_id;
  END IF;
  IF en.enrollment_contractor_contact_id IS NOT NULL THEN
    SELECT x.* INTO cc FROM public.contacts x WHERE x.id = en.enrollment_contractor_contact_id;
  END IF;
  IF en.enrollment_support_contractor_account_id IS NOT NULL THEN
    SELECT x.* INTO sa FROM public.accounts x WHERE x.id = en.enrollment_support_contractor_account_id;
  END IF;
  IF en.enrollment_support_contractor_contact_id IS NOT NULL THEN
    SELECT x.* INTO scc FROM public.contacts x WHERE x.id = en.enrollment_support_contractor_contact_id;
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
    'ssn_used_as_tax_id',                   'No',
    'payment_mailing_street',               en.enrollment_payment_address_line1,
    'payment_mailing_city',                 en.enrollment_payment_city,
    'payment_mailing_state',                en.enrollment_payment_state,
    'payment_mailing_zip',                  en.enrollment_payment_zip
  )) || jsonb_strip_nulls(jsonb_build_object(
    'total_units_in_building',       bl.building_total_units,
    'occupied_units',                en.enrollment_occupied_units,
    'building_square_footage',       bl.building_square_footage,
    -- Two columns hold the same fact on buildings; both are in live use, so
    -- neither is picked over the other by name.
    'total_floors',                  COALESCE(bl.building_stories_of_building, bl.building_stories),
    'year_built',                    bl.building_year_built,
    'income_level',                  (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_income_level),
    'electric_provider',             (SELECT COALESCE(NULLIF(BTRIM(COALESCE(picklist_label,'')),''), picklist_value)
                                        FROM public.picklist_values WHERE id = bl.building_electric_utility),
    'electric_account_number',       bl.building_electric_account_number,
    'heating_fuel_type',             v_heat,
    'gas_provider',                  CASE WHEN v_heat = 'Natural Gas'
                                          THEN (SELECT COALESCE(NULLIF(BTRIM(COALESCE(picklist_label,'')),''), picklist_value)
                                                  FROM public.picklist_values WHERE id = bl.building_gas_utility) END,
    'gas_account_number',            CASE WHEN v_heat = 'Natural Gas' THEN bl.building_gas_account_number END,
    'other_heating_provider',        CASE WHEN v_heat IN ('Propane','Fuel Oil','Wood')
                                          THEN NULLIF(BTRIM(COALESCE(bl.building_heating_fuel_provider,'')), '') END,
    'other_heating_account_number',  CASE WHEN v_heat IN ('Propane','Fuel Oil','Wood')
                                          THEN bl.building_account_number END,
    'work_measures',                 en.enrollment_work_measures,
    'estimated_completion_date',     en.enrollment_estimated_completion_date,
    'submitted_by_first_name',       su.user_first_name,
    'submitted_by_last_name',        su.user_last_name,
    -- The support contractor widget's five columns. Resolved so they can be
    -- handed over; never sent, because a widget iframe cannot be reached.
    'support_contractor_business_name', sa.account_name,
    'support_contractor_contact_name',  NULLIF(BTRIM(COALESCE(scc.contact_name,'')), ''),
    'support_contractor_full_address',  NULLIF(BTRIM(CONCAT_WS(', ',
                                          NULLIF(BTRIM(COALESCE(sa.billing_street,'')),''),
                                          NULLIF(BTRIM(COALESCE(sa.billing_city,'')),''),
                                          NULLIF(BTRIM(COALESCE(sa.billing_state,'')),''),
                                          NULLIF(BTRIM(COALESCE(sa.billing_zip,'')),''))), ''),
    'support_contractor_phone',         scc.contact_phone,
    'support_contractor_email',         scc.contact_email
  )));
END $fn$;

REVOKE ALL ON FUNCTION public.build_wi_ira_project_reservation_form_prefill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_project_reservation_form_prefill(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_target uuid; v_count int; v_hand int; v_src text; v_missing text;
BEGIN
  SELECT id INTO v_target FROM public.external_form_targets
   WHERE eft_key='wi_ira_mf_homes_project_reservation' AND eft_is_deleted IS NOT TRUE;

  SELECT count(*) FILTER (WHERE efm_is_deleted IS NOT TRUE),
         count(*) FILTER (WHERE efm_is_deleted IS NOT TRUE AND efm_url_prefillable IS FALSE)
    INTO v_count, v_hand
    FROM public.external_form_field_map WHERE efm_target_id = v_target;
  IF v_count <> 61 THEN
    RAISE EXCEPTION 'The HOMES map should carry 61 parameters, it carries %', v_count;
  END IF;
  -- Exactly the five support-contractor columns are handed over. If a normal
  -- field slipped into that set it would silently stop being sent.
  IF v_hand <> 5 THEN
    RAISE EXCEPTION 'Expected 5 hand-over fields on the HOMES map, found %', v_hand;
  END IF;

  -- Structural, not data-driven: every mapped payload key must be a key the
  -- resolver actually WRITES. Checking a live record instead would pass or fail
  -- on whether that building happens to have a square footage, which says
  -- nothing about the map. A row whose key nothing produces is the real defect
  -- -- it is a parameter that can never fill, and it is invisible on the form.
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE proname = 'build_wi_ira_project_reservation_form_prefill';
  SELECT string_agg(DISTINCT m.efm_leap_field, ', ') INTO v_missing
    FROM public.external_form_field_map m
   WHERE m.efm_target_id = v_target AND m.efm_is_deleted IS NOT TRUE
     AND position('''' || m.efm_leap_field || '''' IN v_src) = 0;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'The resolver never writes these mapped keys: %', v_missing;
  END IF;
END $assert$;
