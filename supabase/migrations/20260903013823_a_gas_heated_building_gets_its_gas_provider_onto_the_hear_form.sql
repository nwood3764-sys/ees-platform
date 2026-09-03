-- A gas-heated building gets its gas provider onto the HEAR form.
--
-- Found by reading the form for what it will REFUSE, rather than by waiting for
-- it to refuse: of every question on the HEAR submittal marked required that
-- LEAP does not fill, all are hidden behind a condition, and all but these are
-- either Focus On Energy's own administration (Processor, Approver, SPECTRUM
-- numbers, Application Status) or belong to the Final Installation Payment
-- Request branch (the combustion-safety test-out questions, Final Rebate) or to
-- a branch we never take (single-family bedrooms, in-unit owner, individual
-- dwelling-unit floor area).
--
-- These four are different: they are reachable on a Project Reservation today.
-- "How is this building heated?" drives them --
--
--   Natural Gas     -> Natural Gas Provider *      + Natural Gas Account Number *
--   Propane/Oil/Wood-> Other Heating Fuel Provider * + Other Account Number *
--
-- -- and 4 of the 11 live buildings that record a heating fuel are Natural Gas.
-- The first one to file a reservation would have hit two required questions
-- LEAP could have answered and did not: buildings.building_gas_utility and
-- building_gas_account_number have held that data all along.
--
-- THE RESOLVER MIRRORS THE FORM'S OWN CONDITION rather than sending everything
-- and letting the form sort it out. An electric building must not be handed a
-- gas provider: BLD-00075 records its gas utility as "None - Building Has No
-- Natural Gas Service" and its account as "N/A", which is the correct answer to
-- a question about gas service and a nonsense answer in a provider box. So the
-- gas pair is emitted only when the heating fuel IS Natural Gas, and the other
-- pair only for the other fuels.
--
-- Required is deliberately FALSE on all four. Requiredness here is conditional
-- -- the form asks for a gas provider only of a gas building -- and the map has
-- no way to say that. Marking them required would make the completeness gate
-- refuse to open the form for every ELECTRIC building over an answer that
-- building is never asked for, which is a worse failure than the one being
-- fixed.

INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
   efm_option_value_map, efm_field_label, efm_sort_order, efm_is_active, efm_is_required,
   efm_url_prefillable, efm_owner, efm_created_by, efm_updated_by, is_seed_data)
SELECT '', tgt.id, v.leap, v.param, NULL, '{}'::jsonb, v.label, v.ord, true, false, true,
       tgt.eft_owner, tgt.eft_owner, tgt.eft_owner, true
FROM (SELECT id, eft_owner FROM public.external_form_targets
       WHERE eft_key='wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE) tgt,
LATERAL (VALUES
  ('gas_provider','naturalGas','Natural Gas Provider',322),
  ('gas_account_number','naturalGas107','Natural Gas Account Number',324),
  ('other_heating_provider','otherHeating','Other Heating Fuel Provider',326),
  ('other_heating_account_number','otherAccount109','Other Account Number',328)
) AS v(leap, param, label, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_field_map m
   WHERE m.efm_target_id = tgt.id AND m.efm_is_deleted IS NOT TRUE
     AND m.efm_leap_field = v.leap);

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
DECLARE
  v_target uuid; v_count int; v_gas uuid; v_elec uuid; v_p jsonb;
BEGIN
  SELECT id INTO v_target FROM public.external_form_targets
   WHERE eft_key='wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE;

  SELECT count(*) INTO v_count FROM public.external_form_field_map
   WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE;
  IF v_count <> 51 THEN
    RAISE EXCEPTION 'The HEAR map should carry 51 parameters, it carries %', v_count;
  END IF;

  -- None of the four may be required: a required-and-blank field stops the form
  -- opening at all, and an electric building is never asked any of them.
  IF EXISTS (SELECT 1 FROM public.external_form_field_map
              WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE
                AND efm_leap_field IN ('gas_provider','gas_account_number',
                                       'other_heating_provider','other_heating_account_number')
                AND efm_is_required IS TRUE) THEN
    RAISE EXCEPTION 'A conditional heating-fuel question is marked required — that blocks every electric building.';
  END IF;

  -- Behaviour, not shape: a gas building answers, an electric one stays silent.
  SELECT e.id INTO v_gas FROM public.enrollments e
    JOIN public.picklist_values pv ON pv.id = e.enrollment_record_type
    JOIN public.buildings b ON b.id = e.building_id
    JOIN public.picklist_values h ON h.id = b.building_heating_fuel_type
   WHERE pv.picklist_value='WI-IRA-MF-HEAR-Project-Reservation' AND h.picklist_value='Natural Gas'
     AND e.enrollment_is_deleted IS NOT TRUE LIMIT 1;
  SELECT e.id INTO v_elec FROM public.enrollments e
    JOIN public.picklist_values pv ON pv.id = e.enrollment_record_type
    JOIN public.buildings b ON b.id = e.building_id
    JOIN public.picklist_values h ON h.id = b.building_heating_fuel_type
   WHERE pv.picklist_value='WI-IRA-MF-HEAR-Project-Reservation' AND h.picklist_value='Electric'
     AND e.enrollment_is_deleted IS NOT TRUE LIMIT 1;

  IF v_elec IS NOT NULL THEN
    v_p := public.build_wi_ira_hear_project_reservation_form_prefill(v_elec);
    IF (v_p ? 'gas_provider') OR (v_p ? 'gas_account_number') THEN
      RAISE EXCEPTION 'An electric building was handed a gas provider: %', v_p;
    END IF;
    IF (v_p->>'heating_fuel_type') IS DISTINCT FROM 'Electric' THEN
      RAISE EXCEPTION 'The heating fuel stopped resolving: %', v_p->>'heating_fuel_type';
    END IF;
  END IF;
END $assert$;
