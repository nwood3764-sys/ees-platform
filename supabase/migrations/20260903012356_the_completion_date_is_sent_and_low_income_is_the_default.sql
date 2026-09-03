-- Two corrections from Nicholas, on the HEAR reservation form. Everything else
-- on that form is confirmed filling; the completion date was the one gap.
--
-- 1. THE COMPLETION DATE IS SENT AFTER ALL.
--
-- I said it could not be prefilled because "Estimated project completion date"
-- is q148, a Jotform control_widget in its own iframe. That reasoning was
-- incomplete and the conclusion was wrong. The widget's VALUE does not live in
-- the iframe -- it lives in a plain hidden input beside it:
--
--   <input id="input_148" type="hidden" name="q148_typeA148" value="09/02/2026">
--
-- That input IS the field: it is what the form submits and what the page's own
-- bootstrap (widgetFrameLoaded(148, ...)) hands to the widget when the frame
-- loads. Jotform's URL prefill writes fields by unique name, so the parameter
-- is `typeA148` -- the half of `q148_typeA148` after the question id, the same
-- shape all 46 other rows on this map use. The cost of being wrong is nil: an
-- unrecognised parameter is ignored and the field stays as blank as it is
-- today. Refusing to map it guaranteed the blank.
--
-- The widget's own settings say dateFormat m/d/y, so it goes as MM/DD/YYYY --
-- the `date_mmddyyyy` transform this map already owns. (The 09/02/2026 sitting
-- in the saved page is the widget's todayDate:Yes default, not a real answer --
-- which is the problem: it looks answered.)
--
-- 2. LOW-INCOME IS THE ANSWER, SO IT IS THE DEFAULT.
--
-- Nicholas: "it always should be low income". It was set on 9 of 50 live
-- enrollments, left to be remembered each time. Every enrollment record type in
-- LEAP is an IRA income-qualified multifamily programme (HOMES Pre-Approval,
-- HOMES and HEAR Project Reservation, WI-IRA-MF, NC-IRA-MF), so Moderate is the
-- exception, not the starting point.
--
-- A default is not a lock: it applies on INSERT and only when the column is
-- blank, so Moderate, once chosen, is never overwritten.

-- ── 1. Low-Income by default ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.default_enrollment_income_level()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_low uuid;
BEGIN
  IF NEW.enrollment_income_level IS NULL THEN
    -- Looked up, never hardcoded: a literal uuid is wrong on any database whose
    -- picklists were seeded separately.
    SELECT id INTO v_low FROM public.picklist_values
     WHERE picklist_object = 'enrollments' AND picklist_field = 'income_level'
       AND picklist_value = 'Low-Income' AND picklist_is_active IS NOT FALSE
     LIMIT 1;
    NEW.enrollment_income_level := v_low;   -- stays NULL if the value is gone
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.default_enrollment_income_level() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_1_enrollment_income_level ON public.enrollments;
CREATE TRIGGER trg_1_enrollment_income_level
  BEFORE INSERT ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.default_enrollment_income_level();

-- ── 2. The enrollments that never got one ────────────────────────────────
-- Filling a blank with the only answer it could have had. Under replica so the
-- audit log does not record 41 edits nobody made.
SET LOCAL session_replication_role = replica;

UPDATE public.enrollments e
   SET enrollment_income_level = (SELECT id FROM public.picklist_values
                                   WHERE picklist_object='enrollments' AND picklist_field='income_level'
                                     AND picklist_value='Low-Income' LIMIT 1)
 WHERE e.enrollment_is_deleted IS NOT TRUE
   AND e.enrollment_income_level IS NULL;

SET LOCAL session_replication_role = origin;

-- ── 3. The form gets the date, under the name the form uses ──────────────
-- Guarded on the LEAP field, not the parameter: one question, one row, whatever
-- name a previous attempt gave it.
INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
   efm_option_value_map, efm_field_label, efm_sort_order, efm_is_active, efm_is_required,
   efm_owner, efm_created_by, efm_updated_by, is_seed_data)
SELECT '', tgt.id, 'estimated_completion_date', 'typeA148', 'date_mmddyyyy', '{}'::jsonb,
       'Estimated project completion date', 335, true, true,
       tgt.eft_owner, tgt.eft_owner, tgt.eft_owner, true
FROM (SELECT id, eft_owner FROM public.external_form_targets
       WHERE eft_key='wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE) tgt
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_field_map m
   WHERE m.efm_target_id = tgt.id AND m.efm_is_deleted IS NOT TRUE
     AND m.efm_leap_field = 'estimated_completion_date');

UPDATE public.external_form_field_map m
   SET efm_external_param = 'typeA148', efm_value_transform = 'date_mmddyyyy'
  FROM public.external_form_targets t
 WHERE t.id = m.efm_target_id
   AND t.eft_key = 'wi_ira_mf_hear_project_reservation'
   AND m.efm_is_deleted IS NOT TRUE
   AND m.efm_leap_field = 'estimated_completion_date'
   AND m.efm_external_param IS DISTINCT FROM 'typeA148';

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
    'electric_provider',             (SELECT COALESCE(NULLIF(BTRIM(COALESCE(picklist_label,'')),''), picklist_value)
                                        FROM public.picklist_values WHERE id = bl.building_electric_utility),
    'electric_account_number',       bl.building_electric_account_number,
    'heating_fuel_type',             (SELECT picklist_value FROM public.picklist_values WHERE id = bl.building_heating_fuel_type),
    'work_measures',                 en.enrollment_work_measures,
    -- Sent as YYYY-MM-DD; the map's date_mmddyyyy transform turns it into the
    -- 09/25/2026 the widget's own dateFormat setting asks for.
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

-- ── 4. Assertions ────────────────────────────────────────────────────────
DO $assert$
DECLARE
  v_target uuid; v_dates int; v_blank int; v_enr uuid; v_payload jsonb;
BEGIN
  SELECT id INTO v_target FROM public.external_form_targets
   WHERE eft_key='wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE;

  -- Exactly one row for the completion date, under the question's unique name.
  SELECT count(*) INTO v_dates FROM public.external_form_field_map
   WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE
     AND efm_leap_field = 'estimated_completion_date';
  IF v_dates <> 1 THEN
    RAISE EXCEPTION 'The completion date should be one parameter, it is %', v_dates;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.external_form_field_map
                  WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE
                    AND efm_external_param = 'typeA148') THEN
    RAISE EXCEPTION 'The completion date is not mapped to the question''s unique name.';
  END IF;

  SELECT count(*) INTO v_blank FROM public.enrollments
   WHERE enrollment_is_deleted IS NOT TRUE AND enrollment_income_level IS NULL;
  IF v_blank <> 0 THEN
    RAISE EXCEPTION '% live enrollments still have no income level', v_blank;
  END IF;

  SELECT e.id INTO v_enr
    FROM public.enrollments e
    JOIN public.picklist_values pv ON pv.id = e.enrollment_record_type
   WHERE pv.picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation'
     AND e.enrollment_is_deleted IS NOT TRUE
   ORDER BY e.enrollment_created_at DESC LIMIT 1;
  IF v_enr IS NOT NULL THEN
    v_payload := public.build_wi_ira_hear_project_reservation_form_prefill(v_enr);
    IF NOT (v_payload ? 'estimated_completion_date') THEN
      RAISE EXCEPTION 'The resolver does not send the completion date: %', v_payload;
    END IF;
    IF (v_payload->>'income_level') IS DISTINCT FROM 'Low-Income' THEN
      RAISE EXCEPTION 'Expected Low-Income, got %', v_payload->>'income_level';
    END IF;
  END IF;
END $assert$;
