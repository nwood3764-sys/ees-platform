-- The audit incentive application inherits from the enrollment on its own
-- opportunity, so nothing on the assessment application is typed twice.
--
-- Nicholas, 2026-08-25: "we need to inherit everything we can from the
-- enrollment object on the same opportunity. So we don't have to double type
-- anything."
--
-- The situation this answers, in live data: OPP-00136 (5513 North Hopkins,
-- WI-IRA-MF-HOMES-AUDIT) carries BOTH the assessment pre-approval enrollment
-- ENR-00039 -- which already holds the contractor, the composed property
-- address(es), property type, modeling approach, unit and building counts,
-- LEA#s, building details, the requested amount and the estimated assessment
-- date -- AND the incentive application IA-00021, on which every one of those
-- was null. incentive_applications had no inheritance of any kind: its only
-- triggers were record-number, autoname, record-type derivation/enforcement and
-- audit stamping.
--
-- Two purpose-named artifacts, following the shape LEAP already uses for
-- external form wiring (external_form_field_map) and record-state scoping
-- (record_state_scope_sources) -- the mapping is DATA, so a new program pair is
-- rows in a table, not a deploy:
--
--   incentive_application_enrollment_field_map (IAEF-)
--       which incentive-application record type inherits which columns from
--       which enrollment record type, one row per column pair.
--   inherit_incentive_application_from_enrollment()
--       the BEFORE INSERT/UPDATE trigger that applies it.
--
-- Deliberate decisions, each of which the enrollment's own inheritance trigger
-- (enrollment_inherit_from_parents, 2026-08-04) settled first:
--
--   * FILL-IF-NULL. A value typed by hand always wins; inheritance only fills
--     a blank. So correcting the application never fights the enrollment.
--   * STATUS LOCK. Once the application reaches "Incentive Application To Be
--     Submitted" (sort order 3) or beyond, the automation is hands-off --
--     nothing may mutate a record that has gone to the program.
--   * SECURITY INVOKER. RLS on enrollments is enforced against the caller, the
--     same choice enrollment_inherit_from_parents makes. A definer function
--     here would hand a state-restricted user another state's enrollment data
--     through the back door of a shared opportunity.
--   * PICKLIST COLUMNS ARE TRANSLATED, NOT COPIED. enrollment_property_type
--     holds a picklist_values id scoped to picklist_object='enrollments';
--     copying that uuid into ia_property_type would point the application at
--     another object's picklist row. The 'picklist' transform re-resolves by
--     picklist_value into incentive_applications' own list, which is why the
--     preceding migration asserts the two lists carry the same values.

CREATE SEQUENCE IF NOT EXISTS seq_incentive_application_enrollment_field_map;

CREATE TABLE IF NOT EXISTS public.incentive_application_enrollment_field_map (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iaef_record_number          text NOT NULL,
  -- Which incentive application record type inherits...
  iaef_ia_record_type         uuid NOT NULL REFERENCES public.picklist_values(id),
  -- ...from which enrollment record type on the same opportunity.
  iaef_enrollment_record_type uuid NOT NULL REFERENCES public.picklist_values(id),
  iaef_ia_column              text NOT NULL,
  iaef_enrollment_column      text NOT NULL,
  -- NULL = copy the value as-is. 'picklist' = re-resolve the source picklist
  -- row's VALUE into the incentive application's own list for that field.
  iaef_value_transform        text CHECK (iaef_value_transform IN ('picklist')),
  iaef_sort_order             integer NOT NULL DEFAULT 100,
  iaef_is_active              boolean NOT NULL DEFAULT true,
  iaef_notes                  text,
  iaef_owner                  uuid NOT NULL REFERENCES public.users(id),
  iaef_created_by             uuid NOT NULL REFERENCES public.users(id),
  iaef_created_at             timestamptz NOT NULL DEFAULT now(),
  iaef_updated_by             uuid REFERENCES public.users(id),
  iaef_updated_at             timestamptz,
  iaef_is_deleted             boolean NOT NULL DEFAULT false,
  iaef_deleted_at             timestamptz,
  iaef_deleted_by             uuid REFERENCES public.users(id),
  iaef_deletion_reason        text,
  is_seed_data                boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_iaef_pair
  ON public.incentive_application_enrollment_field_map
     (iaef_ia_record_type, iaef_enrollment_record_type, iaef_ia_column)
  WHERE iaef_is_deleted = false;

CREATE OR REPLACE FUNCTION public.set_iaef_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.iaef_record_number := generate_record_number('IAEF-', 'seq_incentive_application_enrollment_field_map');
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_iaef_rn ON public.incentive_application_enrollment_field_map;
CREATE TRIGGER trg_iaef_rn BEFORE INSERT ON public.incentive_application_enrollment_field_map
  FOR EACH ROW EXECUTE FUNCTION set_iaef_record_number();
DROP TRIGGER IF EXISTS trg_audit_iaef ON public.incentive_application_enrollment_field_map;
CREATE TRIGGER trg_audit_iaef AFTER INSERT OR UPDATE OR DELETE
  ON public.incentive_application_enrollment_field_map
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
DROP TRIGGER IF EXISTS trg_iaef_no_hard_delete ON public.incentive_application_enrollment_field_map;
CREATE TRIGGER trg_iaef_no_hard_delete BEFORE DELETE
  ON public.incentive_application_enrollment_field_map
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.incentive_application_enrollment_field_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iaef_select ON public.incentive_application_enrollment_field_map;
CREATE POLICY iaef_select ON public.incentive_application_enrollment_field_map
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS iaef_insert ON public.incentive_application_enrollment_field_map;
CREATE POLICY iaef_insert ON public.incentive_application_enrollment_field_map
  FOR INSERT TO authenticated
  WITH CHECK (app_user_can('incentive_application_enrollment_field_map','create'));
DROP POLICY IF EXISTS iaef_update ON public.incentive_application_enrollment_field_map;
CREATE POLICY iaef_update ON public.incentive_application_enrollment_field_map
  FOR UPDATE TO authenticated
  USING (app_user_can('incentive_application_enrollment_field_map','update'))
  WITH CHECK (app_user_can('incentive_application_enrollment_field_map','update'));
DROP POLICY IF EXISTS iaef_delete ON public.incentive_application_enrollment_field_map;
CREATE POLICY iaef_delete ON public.incentive_application_enrollment_field_map
  FOR DELETE TO authenticated
  USING (app_user_can('incentive_application_enrollment_field_map','delete'));

-- ── The trigger ──────────────────────────────────────────────────────────────
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
  v_target      uuid;
  m             RECORD;
BEGIN
  -- LOCK: past preparation/verification the automation makes no changes at all.
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

  -- Nothing configured for this record type: not an error, just no inheritance.
  IF NOT EXISTS (
    SELECT 1 FROM public.incentive_application_enrollment_field_map
     WHERE iaef_ia_record_type = v_ia_rt
       AND iaef_is_active AND iaef_is_deleted = false
  ) THEN
    RETURN NEW;
  END IF;

  -- The source enrollment: same opportunity, the record type the map names.
  -- An opportunity can carry more than one (OPP-00067 carries two pre-approval
  -- enrollments), so the choice is explicit and deterministic -- most recently
  -- updated, then most recently created, then id -- rather than whichever row
  -- the planner happened to return.
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
    SELECT iaef_ia_column, iaef_enrollment_column, iaef_value_transform
      FROM public.incentive_application_enrollment_field_map
     WHERE iaef_ia_record_type = v_ia_rt
       AND iaef_enrollment_record_type = v_enr.enrollment_record_type
       AND iaef_is_active AND iaef_is_deleted = false
     ORDER BY iaef_sort_order, iaef_ia_column
  LOOP
    -- Fill-if-null: a value already on the application is never overwritten.
    IF v_new_json ->> m.iaef_ia_column IS NOT NULL THEN CONTINUE; END IF;

    v_src := v_enr_json -> m.iaef_enrollment_column;
    IF v_src IS NULL OR jsonb_typeof(v_src) = 'null' THEN CONTINUE; END IF;

    IF m.iaef_value_transform = 'picklist' THEN
      -- Translate through the VALUE, never the id: the source id belongs to the
      -- enrollments picklist and would be meaningless on this object.
      SELECT i.id INTO v_target
        FROM public.picklist_values src
        JOIN public.picklist_values i
          ON i.picklist_object = 'incentive_applications'
         AND i.picklist_field  = src.picklist_field
         AND i.picklist_value  = src.picklist_value
         AND i.picklist_is_active
       WHERE src.id = (v_src #>> '{}')::uuid;
      IF v_target IS NULL THEN CONTINUE; END IF;   -- no counterpart: leave blank
      v_patch := v_patch || jsonb_build_object(m.iaef_ia_column, v_target);
    ELSE
      v_patch := v_patch || jsonb_build_object(m.iaef_ia_column, v_src);
    END IF;
  END LOOP;

  IF v_patch <> '{}'::jsonb THEN
    -- jsonb_populate_record over ~160 columns is affordable here: incentive
    -- applications are created by hand, a few per property. It would NOT be on
    -- properties (828 columns), which is why record audit stamping generates a
    -- per-object trigger instead (2026-08-22).
    NEW := jsonb_populate_record(NEW, v_new_json || v_patch);
  END IF;

  -- Status is never blank, the same rule the enrollment carries.
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

-- Must run AFTER the record type is derived (trg_0_ia_record_type_from_opportunity)
-- and BEFORE the state/program enforcement (trg_zz_*): the map is keyed by
-- record type, so a record type derived later in the same statement would find
-- nothing to inherit. Trigger names fire in alphabetical order.
DROP TRIGGER IF EXISTS trg_1_ia_inherit_from_enrollment ON public.incentive_applications;
CREATE TRIGGER trg_1_ia_inherit_from_enrollment
  BEFORE INSERT OR UPDATE ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION inherit_incentive_application_from_enrollment();

-- ── The WI-IRA-MF-HOMES-AUDIT map ────────────────────────────────────────────
-- Every field the Focus On Energy assessment application asks for that the
-- pre-approval enrollment already holds. Property Owner Name is deliberately
-- absent: it is the property's own HUD owner organisation and the layout reads
-- it as a related field, so storing a second copy on the application would be a
-- value that can go stale.
--
-- Only WI is seeded. NC and MI carry -AUDIT application record types, but their
-- enrollment record types (NC-IRA-MF / MI-IRA-MF) are not assessment
-- pre-approval shaped -- inventing a mapping for a program nobody has confirmed
-- would be a guess. Adding one is rows in this table.
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

  IF v_ia_rt IS NULL OR v_enr_rt IS NULL THEN
    RAISE EXCEPTION 'Record types missing: ia=% enrollment=%', v_ia_rt, v_enr_rt;
  END IF;

  FOR m IN
    SELECT * FROM (VALUES
      ('ia_contractor_account_id',     'enrollment_contractor_account_id',      NULL,       10),
      ('ia_contractor_contact_id',     'enrollment_contractor_contact_id',      NULL,       20),
      ('ia_payment_address_different', 'enrollment_payment_address_different',  NULL,       30),
      ('ia_payment_mailing_street',    'enrollment_payment_address_line1',      NULL,       40),
      ('ia_payment_mailing_city',      'enrollment_payment_city',               NULL,       50),
      ('ia_payment_mailing_state',     'enrollment_payment_state',              NULL,       60),
      ('ia_payment_mailing_zip',       'enrollment_payment_zip',                NULL,       70),
      ('ia_property_addresses',        'enrollment_property_addresses',         NULL,       80),
      ('ia_property_type',             'enrollment_property_type',              'picklist', 90),
      ('ia_modeling_approach',         'enrollment_modeling_approach',          'picklist', 100),
      ('ia_number_of_buildings',       'enrollment_number_of_buildings',        NULL,       110),
      ('ia_units_per_building',        'enrollment_units_per_building',         NULL,       120),
      ('ia_requested_incentive_amount','enrollment_requested_incentive_amount', NULL,       130),
      ('ia_property_lea_numbers',      'enrollment_property_lea_numbers',       NULL,       140),
      ('ia_building_details',          'enrollment_building_details',           NULL,       150),
      ('ia_estimated_assessment_date', 'enrollment_estimated_assessment_date',  NULL,       160)
    ) AS t(ia_col, enr_col, transform, sort_order)
  LOOP
    -- Verify both columns exist before wiring them. A typo here would be a
    -- silently dead mapping, which is worse than a failed migration.
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
       iaef_enrollment_column, iaef_value_transform, iaef_sort_order,
       iaef_record_number, iaef_owner, iaef_created_by)
    VALUES (v_ia_rt, v_enr_rt, m.ia_col, m.enr_col, m.transform, m.sort_order,
            '', v_owner, v_owner)
    ON CONFLICT DO NOTHING;
  END LOOP;

  SELECT count(*) INTO v_n FROM public.incentive_application_enrollment_field_map
   WHERE iaef_ia_record_type = v_ia_rt AND iaef_is_deleted = false;
  IF v_n <> 16 THEN
    RAISE EXCEPTION 'Expected 16 WI-IRA-MF-HOMES-AUDIT mappings, found %', v_n;
  END IF;
END $$;
