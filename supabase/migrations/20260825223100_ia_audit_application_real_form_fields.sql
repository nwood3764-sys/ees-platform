-- Correct the audit application to the form that is actually live.
--
-- Earlier today this was built against Formstack form 6324680, the target
-- external_form_field_map has pointed at since 2026-08-03. Nicholas supplied the
-- form at /forms/ira_assessment_app: it is NOT that form. 6324680 asks "Is the
-- payment address different from the primary address?"; this one does not ask it
-- at all, states the payment address outright, and asks eight questions 6324680
-- never asked. Eight of the nine columns added an hour ago were built for the
-- wrong field list. All nine hold zero values, so this corrects rather than
-- migrates.
--
-- The live form (multifamily branch), section by section:
--   Application Information  - How was the building modeled? (Single Family
--     Attached / Single Family Detached / Multifamily); Are you requesting
--     incentives for more than one property or unit owned by the same person or
--     entity?
--   Assessment Details - Individual Multifamily Building - Property Owner Name;
--     Building name; Assessment Address; How many units are in the building?;
--     What modeling software was used? (BPI-2400 / DOE-2-based software); IRA
--     Income Code; Assessment Date; Assessment Cost; Requested Incentive Amount;
--     Asset Score, BuildingSync File and Invoice uploads; Building Improvements.
--   Assessor Information - Registered Contractor business name; Office Address;
--     Payment Address; Phone; Email.
--   Additional Information - Will the customer be moving forward with a HOMES
--     project? (Yes/No/Unknown); Additional Comments.
--   Terms and Conditions and Signature - five attestations and a typed name.
--
-- Two questions on the live form are NOT the two this platform already had, and
-- are given their own purpose-named picklists rather than bent onto the old ones:
--   * "How was the building modeled?" has three options. The enrollment's
--     Property Type has four (multifamily split 2-3 / 4+).
--   * "What modeling software was used?" has two. The enrollment's Modeling
--     Approach has three (whole-building vs individual-unit BPI 2400). The
--     pre-existing ia_modeling_software is a different question again - a list of
--     vendor products (Snugg Pro, eQuest, TREAT) belonging to another form.
-- Both narrow cleanly FROM the enrollment, which is why the field map gains an
-- option value map: the mapping is many-to-one, and a silent value mismatch would
-- leave a required field blank on a submitted application.

-- 1) The registry learns value-level translation -------------------------------
ALTER TABLE public.incentive_application_enrollment_field_map
  ADD COLUMN IF NOT EXISTS iaef_option_value_map jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.incentive_application_enrollment_field_map.iaef_option_value_map IS
  'For a picklist mapping whose lists do not share values: enrollment picklist_value -> incentive_applications picklist_value. Empty means the value is carried through unchanged.';

-- 2) The columns the live form asks for ----------------------------------------
ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_building_modeled_as           uuid REFERENCES public.picklist_values(id),
  ADD COLUMN IF NOT EXISTS ia_multiple_properties_same_owner boolean,
  ADD COLUMN IF NOT EXISTS ia_assessment_address_line2      text,
  ADD COLUMN IF NOT EXISTS ia_modeling_software_used        uuid REFERENCES public.picklist_values(id),
  ADD COLUMN IF NOT EXISTS ia_ira_income_code               text,
  ADD COLUMN IF NOT EXISTS ia_assessment_date               date,
  ADD COLUMN IF NOT EXISTS ia_assessment_cost               numeric(16,2),
  ADD COLUMN IF NOT EXISTS ia_building_improvements         text,
  ADD COLUMN IF NOT EXISTS ia_moving_forward_with_homes     uuid REFERENCES public.picklist_values(id),
  ADD COLUMN IF NOT EXISTS ia_additional_comments           text,
  ADD COLUMN IF NOT EXISTS ia_terms_and_conditions_agreed   boolean,
  ADD COLUMN IF NOT EXISTS ia_participation_agreement_agreed boolean,
  ADD COLUMN IF NOT EXISTS ia_alternative_funding_attested  boolean,
  ADD COLUMN IF NOT EXISTS ia_model_update_agreed           boolean,
  ADD COLUMN IF NOT EXISTS ia_application_confirmed         boolean,
  ADD COLUMN IF NOT EXISTS ia_signature_first_name          text,
  ADD COLUMN IF NOT EXISTS ia_signature_last_name           text;

COMMENT ON COLUMN public.incentive_applications.ia_building_modeled_as IS
  'Live assessment application: "How was the building modeled?" Three options; narrower than the enrollment Property Type it inherits from.';
COMMENT ON COLUMN public.incentive_applications.ia_modeling_software_used IS
  'Live assessment application: "What modeling software was used?" BPI-2400 or DOE-2-based software. NOT ia_modeling_software, which is another form''s vendor-product list.';
COMMENT ON COLUMN public.incentive_applications.ia_ira_income_code IS
  'Live assessment application: "IRA Income Code". Inherited from the enrollment''s Property LEA#s, itself taken from buildings.ira_confirmation_code_lea - CONFIRM these are the same code before relying on it.';
COMMENT ON COLUMN public.incentive_applications.ia_assessment_date IS
  'Live assessment application: "Assessment Date" - the date shown on the energy assessment report. Seeded from the enrollment''s ESTIMATED assessment date; the assessor corrects it to the report.';
COMMENT ON COLUMN public.incentive_applications.ia_assessment_cost IS
  'Live assessment application: "Assessment Cost". The requested incentive cannot exceed it.';
COMMENT ON COLUMN public.incentive_applications.ia_building_improvements IS
  'Live assessment application: "Building Improvements" - all proposed measures modeled for this property.';
COMMENT ON COLUMN public.incentive_applications.ia_assessment_address_line2 IS
  'Live assessment application: Assessment Address line 2. Its line 1, city, state and ZIP are read from the building; buildings carry no second line.';

-- 3) Picklists -----------------------------------------------------------------
DO $$
DECLARE
  v_owner uuid;
  r RECORD;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
   ORDER BY user_created_at LIMIT 1;

  FOR r IN
    SELECT * FROM (VALUES
      ('building_modeled_as',       'single_family_attached',  'Single Family Attached', 1),
      ('building_modeled_as',       'single_family_detached',  'Single Family Detached', 2),
      ('building_modeled_as',       'multifamily',             'Multifamily',            3),
      ('modeling_software_used',    'bpi_2400',                'BPI-2400',               1),
      ('modeling_software_used',    'doe_2_based_software',    'DOE-2-based software',   2),
      ('moving_forward_with_homes', 'yes',                     'Yes',                    1),
      ('moving_forward_with_homes', 'no',                      'No',                     2),
      ('moving_forward_with_homes', 'unknown',                 'Unknown',                3)
    ) AS t(field, value, label, sort_order)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.picklist_values
       WHERE picklist_object='incentive_applications'
         AND picklist_field=r.field AND picklist_value=r.value
    ) THEN
      INSERT INTO public.picklist_values
        (id, picklist_object, picklist_field, picklist_value, picklist_label,
         picklist_sort_order, picklist_is_active, picklist_created_by)
      VALUES (gen_random_uuid(), 'incentive_applications', r.field, r.value, r.label,
              r.sort_order, true, v_owner);
    END IF;
  END LOOP;

  -- The two lists seeded an hour ago against form 6324680 are retired, not
  -- deleted: hard deletes are blocked platform-wide and an inactive value keeps
  -- the audit trail of what was tried.
  UPDATE public.picklist_values
     SET picklist_is_active = false, picklist_updated_at = now()
   WHERE picklist_object = 'incentive_applications'
     AND picklist_field IN ('property_type', 'modeling_approach');
END $$;

-- 4) The trigger applies the option map ----------------------------------------
CREATE OR REPLACE FUNCTION public.inherit_incentive_application_from_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_status_sort integer;
  v_ia_rt       uuid;
  v_enr         public.enrollments%ROWTYPE;
  v_enr_json    jsonb;
  v_new_json    jsonb;
  v_patch       jsonb := '{}'::jsonb;
  v_src         jsonb;
  v_src_value   text;
  v_tgt_value   text;
  v_target      uuid;
  m             RECORD;
BEGIN
  IF NEW.ia_status IS NOT NULL THEN
    SELECT picklist_sort_order INTO v_status_sort
      FROM public.picklist_values WHERE id = NEW.ia_status;
    IF COALESCE(v_status_sort, 0) >= 3 THEN
      RETURN NEW;
    END IF;
  END IF;

  v_ia_rt := NEW.ia_record_type;
  IF v_ia_rt IS NULL OR NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.incentive_application_enrollment_field_map
     WHERE iaef_ia_record_type = v_ia_rt
       AND iaef_is_active AND iaef_is_deleted = false
  ) THEN
    RETURN NEW;
  END IF;

  SELECT e.* INTO v_enr
  FROM public.enrollments e
  WHERE e.opportunity_id = NEW.opportunity_id
    AND e.enrollment_is_deleted IS NOT TRUE
    AND e.enrollment_record_type IN (
      SELECT iaef_enrollment_record_type
        FROM public.incentive_application_enrollment_field_map
       WHERE iaef_ia_record_type = v_ia_rt
         AND iaef_is_active AND iaef_is_deleted = false)
  ORDER BY COALESCE(e.enrollment_updated_at, e.enrollment_created_at) DESC,
           e.enrollment_created_at DESC, e.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_enr_json := to_jsonb(v_enr);
  v_new_json := to_jsonb(NEW);

  FOR m IN
    SELECT iaef_ia_column, iaef_enrollment_column, iaef_value_transform, iaef_option_value_map
      FROM public.incentive_application_enrollment_field_map
     WHERE iaef_ia_record_type = v_ia_rt
       AND iaef_enrollment_record_type = v_enr.enrollment_record_type
       AND iaef_is_active AND iaef_is_deleted = false
     ORDER BY iaef_sort_order, iaef_ia_column
  LOOP
    IF v_new_json ->> m.iaef_ia_column IS NOT NULL THEN CONTINUE; END IF;

    v_src := v_enr_json -> m.iaef_enrollment_column;
    IF v_src IS NULL OR jsonb_typeof(v_src) = 'null' THEN CONTINUE; END IF;

    IF m.iaef_value_transform = 'picklist' THEN
      SELECT src.picklist_value INTO v_src_value
        FROM public.picklist_values src WHERE src.id = (v_src #>> '{}')::uuid;
      IF v_src_value IS NULL THEN CONTINUE; END IF;

      -- Many-to-one lists translate through the map; an unmapped value carries
      -- its own spelling across, which is right when both lists agree.
      v_tgt_value := COALESCE(m.iaef_option_value_map ->> v_src_value, v_src_value);

      SELECT i.id INTO v_target
        FROM public.picklist_values i
       WHERE i.picklist_object = 'incentive_applications'
         AND i.picklist_value  = v_tgt_value
         AND i.picklist_field  = (
             SELECT fm.picklist_field FROM public.picklist_values fm
              WHERE fm.picklist_object = 'incentive_applications'
                AND fm.picklist_value = v_tgt_value
                AND fm.picklist_is_active
              LIMIT 1)
         AND i.picklist_is_active
       LIMIT 1;
      IF v_target IS NULL THEN CONTINUE; END IF;
      v_patch := v_patch || jsonb_build_object(m.iaef_ia_column, v_target);
    ELSE
      v_patch := v_patch || jsonb_build_object(m.iaef_ia_column, v_src);
    END IF;
  END LOOP;

  IF v_patch <> '{}'::jsonb THEN
    NEW := jsonb_populate_record(NEW, v_new_json || v_patch);
  END IF;

  IF NEW.ia_status IS NULL THEN
    SELECT id INTO NEW.ia_status FROM public.picklist_values
     WHERE picklist_object = 'incentive_applications'
       AND picklist_field  = 'ia_status'
       AND picklist_value  = 'Incentive Application To Be Prepared'
       AND picklist_is_active
     LIMIT 1;
  END IF;

  RETURN NEW;
END $fn$;

-- 5) Remap WI-IRA-MF-HOMES-AUDIT to the live form ------------------------------
DO $$
DECLARE
  v_owner  uuid;
  v_ia_rt  uuid;
  v_enr_rt uuid;
  v_n      integer;
  m        RECORD;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
   ORDER BY user_created_at LIMIT 1;
  SELECT id INTO v_ia_rt FROM public.picklist_values
   WHERE picklist_object='incentive_applications' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HOMES-AUDIT';
  SELECT id INTO v_enr_rt FROM public.picklist_values
   WHERE picklist_object='enrollments' AND picklist_field='record_type'
     AND picklist_value='WI-IRA-MF-HOMES-Assessment-Preapproval';

  -- Retire the mappings onto columns the live form does not have.
  UPDATE public.incentive_application_enrollment_field_map
     SET iaef_is_deleted = true, iaef_deleted_at = now(),
         iaef_deletion_reason = 'Built against Formstack form 6324680; the live /forms/ira_assessment_app does not ask this.'
   WHERE iaef_ia_record_type = v_ia_rt
     AND iaef_is_deleted = false
     AND iaef_ia_column IN ('ia_property_type','ia_modeling_approach','ia_property_addresses',
                            'ia_number_of_buildings','ia_property_lea_numbers','ia_building_details',
                            'ia_estimated_assessment_date','ia_payment_address_different');

  FOR m IN
    SELECT * FROM (VALUES
      ('ia_building_modeled_as',     'enrollment_property_type',              'picklist',
       '{"single_family_attached":"single_family_attached","single_family_detached":"single_family_detached","multifamily_2_3_units":"multifamily","multifamily_4_plus_units":"multifamily"}', 10),
      ('ia_modeling_software_used',  'enrollment_modeling_approach',          'picklist',
       '{"individual_units_bpi_2400":"bpi_2400","whole_building_bpi_2400":"bpi_2400","whole_building_doe2":"doe_2_based_software"}', 20),
      ('ia_ira_income_code',         'enrollment_property_lea_numbers',       NULL, '{}', 30),
      ('ia_assessment_date',         'enrollment_estimated_assessment_date',  NULL, '{}', 40),
      ('ia_units_per_building',      'enrollment_units_per_building',         NULL, '{}', 50),
      ('ia_requested_incentive_amount','enrollment_requested_incentive_amount', NULL, '{}', 60),
      ('ia_contractor_account_id',   'enrollment_contractor_account_id',      NULL, '{}', 70),
      ('ia_contractor_contact_id',   'enrollment_contractor_contact_id',      NULL, '{}', 80),
      ('ia_payment_mailing_street',  'enrollment_payment_address_line1',      NULL, '{}', 90),
      ('ia_payment_mailing_city',    'enrollment_payment_city',               NULL, '{}', 100),
      ('ia_payment_mailing_state',   'enrollment_payment_state',              NULL, '{}', 110),
      ('ia_payment_mailing_zip',     'enrollment_payment_zip',                NULL, '{}', 120)
    ) AS t(ia_col, enr_col, transform, option_map, sort_order)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='incentive_applications'
                      AND column_name=m.ia_col) THEN
      RAISE EXCEPTION 'incentive_applications has no column %', m.ia_col;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='enrollments'
                      AND column_name=m.enr_col) THEN
      RAISE EXCEPTION 'enrollments has no column %', m.enr_col;
    END IF;

    INSERT INTO public.incentive_application_enrollment_field_map
      (iaef_ia_record_type, iaef_enrollment_record_type, iaef_ia_column,
       iaef_enrollment_column, iaef_value_transform, iaef_option_value_map,
       iaef_sort_order, iaef_record_number, iaef_owner, iaef_created_by)
    VALUES (v_ia_rt, v_enr_rt, m.ia_col, m.enr_col, m.transform, m.option_map::jsonb,
            m.sort_order, '', v_owner, v_owner)
    ON CONFLICT DO NOTHING;
  END LOOP;

  SELECT count(*) INTO v_n FROM public.incentive_application_enrollment_field_map
   WHERE iaef_ia_record_type = v_ia_rt AND iaef_is_deleted = false AND iaef_is_active;
  IF v_n <> 12 THEN
    RAISE EXCEPTION 'Expected 12 live mappings for the audit application, found %', v_n;
  END IF;

  -- Every mapped picklist value must land somewhere. A silent miss would leave a
  -- REQUIRED field blank on an application that goes to the program.
  FOR m IN
    SELECT f.iaef_ia_column, src.picklist_value AS src_value,
           COALESCE(f.iaef_option_value_map ->> src.picklist_value, src.picklist_value) AS tgt_value
      FROM public.incentive_application_enrollment_field_map f
      JOIN public.picklist_values src
        ON src.picklist_object = 'enrollments'
       AND src.picklist_field = replace(f.iaef_enrollment_column, 'enrollment_', '')
       AND src.picklist_is_active
     WHERE f.iaef_ia_record_type = v_ia_rt AND f.iaef_is_deleted = false
       AND f.iaef_value_transform = 'picklist'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.picklist_values i
       WHERE i.picklist_object='incentive_applications'
         AND i.picklist_value = m.tgt_value AND i.picklist_is_active)
    THEN
      RAISE EXCEPTION 'Mapping % : enrollment value "%" translates to "%", which no active incentive_applications value carries',
        m.iaef_ia_column, m.src_value, m.tgt_value;
    END IF;
  END LOOP;
END $$;
