-- External form prefill: WI-IRA-MF-HOMES Assessment Pre-Approval (Focus On Energy)
--
-- Goal: from a WI-IRA-MF-HOMES-Assessment-Preapproval enrollment, one click opens
-- the Focus On Energy pre-approval form (hosted on Formstack, form id 6324680)
-- with every field -- text boxes, address blocks, radios -- already filled in, so
-- the assessor only reviews and clicks Submit.
--
-- The form fills from its URL query string (`?field<ID>=Value`). Two data-driven
-- pieces make this work without hardcoding form ids in app code:
--
--   1. build_wi_ira_assessment_prefill(enrollment) -- resolves ONE enrollment into
--      a flat {leap_field: value} dictionary (picklist ids -> labels, addresses as
--      their parts). SECURITY INVOKER, so it only returns enrollments the caller
--      may see under RLS.
--
--   2. external_form_targets / external_form_field_map -- the target form and the
--      per-field wiring (which enrollment field feeds which Formstack `field<ID>`,
--      how the value is transformed, and any option-label -> option-value map for
--      radios). Admin-editable at the database level, so the mapping changes when
--      the external form changes WITHOUT a code deploy. A second program's form
--      (e.g. the single-family / payment application) is simply another target row.
--
-- The mapping was read directly from the live form definition (form 6324680): all
-- 13 required fields map 1:1 to enrollment columns; radios store their `value`
-- (Property Type values equal the LEAP picklist labels; Modeling values carry a
-- parenthetical suffix, handled by efm_option_value_map); addresses use the
-- `field<ID>-address/-city/-state/-zip` subfield params; the date is MM/DD/YYYY.

-- 1) Config tables -----------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_external_form_targets;
CREATE SEQUENCE IF NOT EXISTS seq_external_form_field_map;

CREATE TABLE public.external_form_targets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eft_record_number      text NOT NULL,
  eft_key                text NOT NULL,
  eft_name               text NOT NULL,
  eft_description        text,
  -- How the target is filled. Only URL query-string prefill is built today; the
  -- column exists so a fillable-PDF or portal target can be added later.
  eft_kind               text NOT NULL DEFAULT 'prefill_url' CHECK (eft_kind IN ('prefill_url')),
  eft_base_url           text NOT NULL,
  eft_form_provider      text,                                   -- e.g. 'formstack'
  eft_external_form_id   text,                                   -- e.g. '6324680'
  -- The LEAP object + record type this form serves. The button resolves the
  -- target for an enrollment by (object, record_type).
  eft_object             text NOT NULL DEFAULT 'enrollments',
  eft_record_type        uuid REFERENCES picklist_values(id),
  eft_submit_note        text,                                   -- guidance shown before opening
  eft_is_active          boolean NOT NULL DEFAULT true,
  eft_notes              text,
  eft_owner              uuid NOT NULL REFERENCES users(id),
  eft_created_by         uuid NOT NULL REFERENCES users(id),
  eft_created_at         timestamptz NOT NULL DEFAULT now(),
  eft_updated_by         uuid REFERENCES users(id),
  eft_updated_at         timestamptz,
  eft_is_deleted         boolean NOT NULL DEFAULT false,
  eft_deleted_at         timestamptz,
  eft_deleted_by         uuid REFERENCES users(id),
  eft_deletion_reason    text,
  is_seed_data           boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX uq_eft_key ON public.external_form_targets (eft_key)
  WHERE eft_is_deleted = false;

CREATE TABLE public.external_form_field_map (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  efm_record_number      text NOT NULL,
  efm_target_id          uuid NOT NULL REFERENCES external_form_targets(id),
  efm_leap_field         text NOT NULL,   -- key in the build_*_prefill() dictionary
  efm_external_param     text NOT NULL,   -- Formstack query param, e.g. field188466720 / field192038737-city
  efm_value_transform    text,            -- NULL | 'bool_yes_no' | 'date_mmddyyyy'
  efm_option_value_map   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- LEAP label -> external option value
  efm_field_label        text,            -- the external form's human label (reference)
  efm_sort_order         integer NOT NULL DEFAULT 100,
  efm_is_active          boolean NOT NULL DEFAULT true,
  efm_owner              uuid NOT NULL REFERENCES users(id),
  efm_created_by         uuid NOT NULL REFERENCES users(id),
  efm_created_at         timestamptz NOT NULL DEFAULT now(),
  efm_updated_by         uuid REFERENCES users(id),
  efm_updated_at         timestamptz,
  efm_is_deleted         boolean NOT NULL DEFAULT false,
  efm_deleted_at         timestamptz,
  efm_deleted_by         uuid REFERENCES users(id),
  efm_deletion_reason    text,
  is_seed_data           boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_efm_target ON public.external_form_field_map (efm_target_id)
  WHERE efm_is_deleted = false;

-- Record-number + audit + no-hard-delete triggers (standard config-table set).
CREATE OR REPLACE FUNCTION public.set_eft_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.eft_record_number := generate_record_number('EFT-', 'seq_external_form_targets');
  RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION public.set_efm_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.efm_record_number := generate_record_number('EFM-', 'seq_external_form_field_map');
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_eft_rn BEFORE INSERT ON public.external_form_targets
  FOR EACH ROW EXECUTE FUNCTION set_eft_record_number();
CREATE TRIGGER trg_audit_eft AFTER INSERT OR UPDATE OR DELETE ON public.external_form_targets
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_eft_no_hard_delete BEFORE DELETE ON public.external_form_targets
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();
CREATE TRIGGER trg_efm_rn BEFORE INSERT ON public.external_form_field_map
  FOR EACH ROW EXECUTE FUNCTION set_efm_record_number();
CREATE TRIGGER trg_audit_efm AFTER INSERT OR UPDATE OR DELETE ON public.external_form_field_map
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_efm_no_hard_delete BEFORE DELETE ON public.external_form_field_map
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.external_form_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY eft_select ON public.external_form_targets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY eft_insert ON public.external_form_targets
  FOR INSERT TO authenticated WITH CHECK (app_user_can('external_form_targets','create'));
CREATE POLICY eft_update ON public.external_form_targets
  FOR UPDATE TO authenticated USING (app_user_can('external_form_targets','update'))
  WITH CHECK (app_user_can('external_form_targets','update'));
CREATE POLICY eft_delete ON public.external_form_targets
  FOR DELETE TO authenticated USING (app_user_can('external_form_targets','delete'));

ALTER TABLE public.external_form_field_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY efm_select ON public.external_form_field_map
  FOR SELECT TO authenticated USING (true);
CREATE POLICY efm_insert ON public.external_form_field_map
  FOR INSERT TO authenticated WITH CHECK (app_user_can('external_form_field_map','create'));
CREATE POLICY efm_update ON public.external_form_field_map
  FOR UPDATE TO authenticated USING (app_user_can('external_form_field_map','update'))
  WITH CHECK (app_user_can('external_form_field_map','update'));
CREATE POLICY efm_delete ON public.external_form_field_map
  FOR DELETE TO authenticated USING (app_user_can('external_form_field_map','delete'));

-- 2) Prefill RPC -------------------------------------------------------------
-- Resolves ONE assessment pre-approval enrollment into a flat dictionary keyed
-- by pre-approval-form field name, matching the live pre-approval page layout:
--   * contractor name / email / primary address  -> the linked contractor ACCOUNT
--     (enrollment_contractor_account_id -> accounts.account_name/account_email/
--      billing_street/billing_city/billing_state/billing_zip)
--   * property owner name -> properties.property_hud_owner_org (via property_id)
--   * number of buildings -> properties.property_number_of_buildings (via property_id)
--   * payment address -> the enrollment's own payment_* columns, falling back to
--     the contractor's primary (billing) address when "payment different" is not Yes.
-- SECURITY INVOKER (default): RLS on enrollments/accounts/properties is enforced
-- against the caller. Returns {} for a missing/forbidden row or the wrong record
-- type, so the client simply opens an empty form.
CREATE OR REPLACE FUNCTION public.build_wi_ira_assessment_prefill(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  e         public.enrollments%ROWTYPE;
  ca        public.accounts%ROWTYPE;   -- contractor account (may be unset)
  rt        text;
  pt        text;                       -- property type label
  ma        text;                       -- modeling approach label
  po        text;                       -- property owner org
  nb        integer;                    -- property number of buildings
  pay_diff  boolean;
  pay_l1    text;
  pay_city  text;
  pay_state text;
  pay_zip   text;
BEGIN
  IF p_enrollment_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT en.* INTO e
  FROM public.enrollments en
  WHERE en.id = p_enrollment_id
    AND en.enrollment_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT picklist_value INTO rt FROM public.picklist_values WHERE id = e.enrollment_record_type;
  IF rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-Assessment-Preapproval' THEN RETURN '{}'::jsonb; END IF;

  SELECT picklist_label INTO pt FROM public.picklist_values WHERE id = e.enrollment_property_type;
  SELECT picklist_label INTO ma FROM public.picklist_values WHERE id = e.enrollment_modeling_approach;

  IF e.enrollment_contractor_account_id IS NOT NULL THEN
    SELECT a.* INTO ca FROM public.accounts a WHERE a.id = e.enrollment_contractor_account_id;
  END IF;

  IF e.property_id IS NOT NULL THEN
    SELECT p.property_hud_owner_org, p.property_number_of_buildings
      INTO po, nb
    FROM public.properties p WHERE p.id = e.property_id;
  END IF;

  -- Payment address: use the enrollment's own values when marked different;
  -- otherwise mirror the contractor's primary (billing) address.
  pay_diff := COALESCE(e.enrollment_payment_address_different, false);
  IF pay_diff THEN
    pay_l1 := e.enrollment_payment_address_line1; pay_city := e.enrollment_payment_city;
    pay_state := e.enrollment_payment_state;      pay_zip := e.enrollment_payment_zip;
  ELSE
    pay_l1 := ca.billing_street; pay_city := ca.billing_city;
    pay_state := ca.billing_state; pay_zip := ca.billing_zip;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'enrollment_contractor_name',                  ca.account_name,
    'enrollment_contractor_email',                 ca.account_email,
    'enrollment_contractor_primary_address_line1', ca.billing_street,
    'enrollment_contractor_primary_city',          ca.billing_city,
    'enrollment_contractor_primary_state',         ca.billing_state,
    'enrollment_contractor_primary_zip',           ca.billing_zip,
    'enrollment_payment_address_different',        pay_diff,
    'enrollment_payment_address_line1',            pay_l1,
    'enrollment_payment_city',                     pay_city,
    'enrollment_payment_state',                    pay_state,
    'enrollment_payment_zip',                      pay_zip,
    'enrollment_owner_organization',               po,
    'enrollment_property_addresses',               e.enrollment_property_addresses,
    'enrollment_property_type',                    pt,
    'enrollment_units_per_building',               e.enrollment_units_per_building::text,
    'enrollment_modeling_approach',                ma,
    'enrollment_number_of_buildings',              nb::text,
    'enrollment_requested_incentive_amount',       e.enrollment_requested_incentive_amount::text,
    'enrollment_property_lea_numbers',             e.enrollment_property_lea_numbers,
    'enrollment_building_details',                 e.enrollment_building_details,
    'enrollment_estimated_assessment_date',        to_char(e.enrollment_estimated_assessment_date, 'YYYY-MM-DD')
  ));
END $$;

-- 3) Field-map read RPC ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_external_form_map(p_key text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'key',              t.eft_key,
      'name',             t.eft_name,
      'kind',             t.eft_kind,
      'base_url',         t.eft_base_url,
      'provider',         t.eft_form_provider,
      'external_form_id', t.eft_external_form_id,
      'object',           t.eft_object,
      'record_type',      t.eft_record_type,
      'submit_note',      t.eft_submit_note,
      'fields', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'leap_field',       m.efm_leap_field,
                 'param',            m.efm_external_param,
                 'transform',        m.efm_value_transform,
                 'option_value_map', m.efm_option_value_map
               ) ORDER BY m.efm_sort_order, m.efm_record_number)
        FROM public.external_form_field_map m
        WHERE m.efm_target_id = t.id AND m.efm_is_active AND m.efm_is_deleted IS NOT TRUE
      ), '[]'::jsonb)
    )
    FROM public.external_form_targets t
    WHERE t.eft_key = p_key AND t.eft_is_active AND t.eft_is_deleted IS NOT TRUE
    LIMIT 1
  ), '{}'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.build_wi_ira_assessment_prefill(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_external_form_map(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_assessment_prefill(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_external_form_map(text) TO authenticated;

-- 4) Seed the Focus On Energy pre-approval target + field map ----------------
DO $seed$
DECLARE
  v_admin  uuid := (SELECT u.id FROM public.users u JOIN public.roles r ON r.id=u.role_id
                    WHERE r.role_name='Admin' AND u.user_is_active AND u.user_is_deleted IS NOT TRUE
                    ORDER BY u.user_created_at LIMIT 1);
  v_rt     uuid := (SELECT id FROM public.picklist_values
                    WHERE picklist_object='enrollments' AND picklist_field='record_type'
                      AND picklist_value='WI-IRA-MF-HOMES-Assessment-Preapproval' LIMIT 1);
  v_target uuid;
BEGIN
  INSERT INTO public.external_form_targets
    (eft_record_number, eft_key, eft_name, eft_description, eft_kind, eft_base_url,
     eft_form_provider, eft_external_form_id, eft_object, eft_record_type, eft_submit_note,
     eft_owner, eft_created_by, is_seed_data)
  VALUES
    ('', 'wi_ira_mf_homes_assessment_preapproval',
     'Focus On Energy - Multifamily Low Income Assessment Pre-Approval',
     'Focus On Energy IRA HOMES multifamily (4+ unit) energy assessment pre-approval request. Opens the hosted form pre-filled from the enrollment; the assessor reviews, attaches the required documents, and submits.',
     'prefill_url',
     'https://focusonenergy.formstack.com/forms/multifamily_low_income_energy_assessment_incentive_application',
     'formstack', '6324680', 'enrollments', v_rt,
     'Review every field, attach the required documents (they cannot be pre-filled), then click Submit on the Focus On Energy form.',
     v_admin, v_admin, true)
  RETURNING id INTO v_target;

  INSERT INTO public.external_form_field_map
    (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
     efm_option_value_map, efm_field_label, efm_sort_order, efm_owner, efm_created_by, is_seed_data)
  VALUES
    ('', v_target, 'enrollment_contractor_name',                  'field188466720',        NULL, '{}'::jsonb, 'Registered Contractor Name',        10,  v_admin, v_admin, true),
    ('', v_target, 'enrollment_contractor_email',                 'field188492405',        NULL, '{}'::jsonb, 'Registered Contractor Email',       20,  v_admin, v_admin, true),
    ('', v_target, 'enrollment_contractor_primary_address_line1', 'field192038737-address',NULL, '{}'::jsonb, 'Primary Address - street',          30,  v_admin, v_admin, true),
    ('', v_target, 'enrollment_contractor_primary_city',          'field192038737-city',   NULL, '{}'::jsonb, 'Primary Address - city',            40,  v_admin, v_admin, true),
    ('', v_target, 'enrollment_contractor_primary_state',         'field192038737-state',  'state_2letter', '{}'::jsonb, 'Primary Address - state',    50,  v_admin, v_admin, true),
    ('', v_target, 'enrollment_contractor_primary_zip',           'field192038737-zip',    NULL, '{}'::jsonb, 'Primary Address - ZIP',             60,  v_admin, v_admin, true),
    ('', v_target, 'enrollment_payment_address_different',        'field192040105',        'bool_yes_no', '{}'::jsonb, 'Is the payment address different from the primary address?', 70, v_admin, v_admin, true),
    ('', v_target, 'enrollment_payment_address_line1',            'field192039209-address',NULL, '{}'::jsonb, 'Payment Address - street',          80,  v_admin, v_admin, true),
    ('', v_target, 'enrollment_payment_city',                     'field192039209-city',   NULL, '{}'::jsonb, 'Payment Address - city',            90,  v_admin, v_admin, true),
    ('', v_target, 'enrollment_payment_state',                    'field192039209-state',  'state_2letter', '{}'::jsonb, 'Payment Address - state',    100, v_admin, v_admin, true),
    ('', v_target, 'enrollment_payment_zip',                      'field192039209-zip',    NULL, '{}'::jsonb, 'Payment Address - ZIP',             110, v_admin, v_admin, true),
    ('', v_target, 'enrollment_owner_organization',               'field188466725',        NULL, '{}'::jsonb, 'Property Owner Name',               120, v_admin, v_admin, true),
    ('', v_target, 'enrollment_property_addresses',               'field188467725',        NULL, '{}'::jsonb, 'Property Address(es)',              130, v_admin, v_admin, true),
    ('', v_target, 'enrollment_property_type',                    'field188492370',        NULL, '{}'::jsonb, 'Property Type',                     140, v_admin, v_admin, true),
    ('', v_target, 'enrollment_units_per_building',               'field188467586',        NULL, '{}'::jsonb, 'Number of units per building',      150, v_admin, v_admin, true),
    ('', v_target, 'enrollment_modeling_approach',                'field190043698',        NULL,
        jsonb_build_object(
          'Individual Units - BPI 2400',          'Individual Units - BPI 2400 (Each unit will require its own EA#)',
          'Whole Building - BPI 2400',            'Whole Building - BPI 2400 (Whole Building EA# is accepted)',
          'Whole Building - DOE-2-based software', 'Whole Building - DOE-2-based software (Whole Building EA# is accepted)'
        ),
        'How will the property be modeled?', 160, v_admin, v_admin, true),
    ('', v_target, 'enrollment_number_of_buildings',              'field188492194',        NULL, '{}'::jsonb, 'Number of buildings',               170, v_admin, v_admin, true),
    ('', v_target, 'enrollment_requested_incentive_amount',       'field190266215',        NULL, '{}'::jsonb, 'Requested Incentive Amount',        180, v_admin, v_admin, true),
    ('', v_target, 'enrollment_property_lea_numbers',             'field188467845',        NULL, '{}'::jsonb, 'Property LEA#s',                    190, v_admin, v_admin, true),
    ('', v_target, 'enrollment_building_details',                 'field188467882',        NULL, '{}'::jsonb, 'Building Details',                  200, v_admin, v_admin, true),
    ('', v_target, 'enrollment_estimated_assessment_date',        'field192038904',        'date_mmddyyyy', '{}'::jsonb, 'Estimated Assessment Date', 210, v_admin, v_admin, true);
END $seed$;

NOTIFY pgrst, 'reload schema';
