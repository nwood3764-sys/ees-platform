-- Project-Reservation defaults: the renamed picklist value, two defaults that
-- were never there, and a guard so a rename cannot do this again silently.
--
-- Nicholas, on a WI-IRA-MF-HOMES Project Reservation enrollment: "Who is
-- submitting should be populated to Lucas. The modeling software should always
-- be Energy Plus." And: "The building types are not coming in. It's always
-- multi-family, more than five units."
--
-- THE ROOT CAUSE, which is a class of bug rather than a typo.
-- set_enrollment_reservation_defaults resolves nine values by literal STRING --
-- seven picklist values and two account names. The picklist value seeded on
-- 2026-07-29 as 'Multifamily - Central 5 Units' was later renamed to
-- 'Multifamily - Central 5+ Units'. The trigger still asked for the old
-- spelling, got NULL, and assigned NULL. A lookup that finds nothing is
-- indistinguishable from "no default configured", so nothing failed, nothing
-- logged, and the field simply stopped filling in. That is exactly why 13 of the
-- 14 live reservation enrollments carry the value (created before the rename)
-- and only the newest, ENR-00064, is blank.
--
-- Audited all nine: this was the only broken one. The two account names and the
-- other six picklist values still resolve.
--
-- Three changes:
--   1. The building project type asks for the value that exists.
--   2. Modeling Software defaults to Energy Plus, and Who is submitting this
--      form defaults to Lucas Wood -- neither had a default at all, which is why
--      they came up blank every time.
--   3. find_unresolvable_reservation_defaults() reads the trigger's OWN source
--      and reports any literal in it that no longer resolves. It parses prosrc
--      rather than repeating the list, so there is no second copy to drift out
--      of step -- the thing that made this bug possible in the first place.
--      The migration raises if it returns anything.
--
-- Everything else in the trigger is verbatim -- including its
-- `SET search_path TO 'public', 'pg_catalog'`, which is easy to lose here:
-- pg_proc.prosrc holds only the function BODY, not the SET clause (that lives
-- in proconfig), so rebuilding a function from prosrc alone silently drops it
-- and the advisors report function_search_path_mutable. Read the previous
-- migration's header, not just prosrc.

CREATE OR REPLACE FUNCTION public.set_enrollment_reservation_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_rt text; v_code text; v_measures jsonb;
BEGIN
  SELECT picklist_value INTO v_rt FROM picklist_values WHERE id = NEW.enrollment_record_type;
  IF v_rt IS NULL OR v_rt NOT ILIKE '%Project-Reservation%' THEN RETURN NEW; END IF;

  IF NEW.enrollment_application_for IS NULL THEN
    NEW.enrollment_application_for := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='application_for' AND picklist_value='Project Reservation' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_building_type IS NULL THEN
    NEW.enrollment_building_type := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='building_type' AND picklist_value='Existing' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_building_project_type IS NULL THEN
    NEW.enrollment_building_project_type := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='building_project_type' AND picklist_value='Multifamily - Central 5+ Units' AND picklist_is_active LIMIT 1);
  END IF;

  -- Who files these with Focus On Energy. A person, so it is deliberately
  -- resolved by EMAIL rather than by a uuid pasted into code: the address is
  -- readable, and the guard below reports it the day it stops matching an
  -- active user. Fill-blank-only, so reassigning it on a record sticks.
  IF NEW.enrollment_submitted_by IS NULL THEN
    NEW.enrollment_submitted_by := (SELECT id FROM users WHERE user_email='lucas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE AND user_is_active LIMIT 1);
  END IF;

  -- Modeling software is asked only by the HOMES reservation form; the HEAR
  -- reservation layout does not carry the field, and filling a column that no
  -- layout shows would be an invisible value nobody can correct.
  IF NEW.enrollment_modeling_software IS NULL AND v_rt ILIKE '%HOMES%' THEN
    NEW.enrollment_modeling_software := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='modeling_software' AND picklist_value='Energy Plus' AND picklist_is_active LIMIT 1);
  END IF;

  -- Primary contractor = Sealed Inc; support contractor = Energy Efficiency
  -- Services of Wisconsin. Which COMPANY runs the program is program config;
  -- which PERSON represents it is read off that company's account record.
  IF NEW.enrollment_contractor_account_id IS NULL THEN
    NEW.enrollment_contractor_account_id := (SELECT id FROM accounts WHERE account_is_deleted IS NOT TRUE AND account_name='Sealed Inc' LIMIT 1);
  END IF;

  IF NEW.enrollment_has_support_contractor IS NULL THEN NEW.enrollment_has_support_contractor := true; END IF;
  IF NEW.enrollment_support_contractor_account_id IS NULL THEN
    NEW.enrollment_support_contractor_account_id := (SELECT id FROM accounts WHERE account_is_deleted IS NOT TRUE AND account_name='Energy Efficiency Services of Wisconsin' LIMIT 1);
  END IF;
  IF NEW.enrollment_support_contractor_contact_id IS NULL THEN
    NEW.enrollment_support_contractor_contact_id := public.contractor_contact_for_account(
      NEW.enrollment_support_contractor_account_id, NULL);
  END IF;

  IF NEW.enrollment_payee IS NULL THEN
    NEW.enrollment_payee := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='payee' AND picklist_value='Registered Contractor' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_tax_classification IS NULL THEN
    NEW.enrollment_tax_classification := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='tax_classification' AND picklist_value='S Corporation' AND picklist_is_active LIMIT 1);
  END IF;

  IF NEW.enrollment_signer_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_signer_contact_id := (SELECT opportunity_authorized_signer_id FROM opportunities WHERE id = NEW.opportunity_id);
  END IF;
  IF NEW.enrollment_contractor_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_contractor_contact_id := (
      SELECT ocr.contact_id FROM opportunity_contact_roles ocr
      JOIN picklist_values pv ON pv.id = ocr.ocr_role
      WHERE ocr.opportunity_id = NEW.opportunity_id AND ocr.ocr_is_deleted IS NOT TRUE
        AND pv.picklist_value = 'Contractor Primary Contact'
      ORDER BY ocr.ocr_is_primary DESC NULLS LAST, ocr.ocr_created_at ASC LIMIT 1);
  END IF;
  IF NEW.enrollment_contractor_contact_id IS NULL THEN
    NEW.enrollment_contractor_contact_id := public.contractor_contact_for_account(
      NEW.enrollment_contractor_account_id, NULL);
  END IF;

  IF (NEW.enrollment_work_measures IS NULL OR NEW.enrollment_work_measures = '[]'::jsonb)
     AND NEW.opportunity_id IS NOT NULL THEN
    SELECT jsonb_agg(DISTINCT m.pwmm_work_measure ORDER BY m.pwmm_work_measure)
      INTO v_measures
      FROM opportunity_line_items oli
      JOIN product_work_measure_map m
        ON m.pwmm_product_id = oli.product_id AND m.pwmm_is_deleted IS NOT TRUE
     WHERE oli.opportunity_id = NEW.opportunity_id AND oli.oli_is_deleted IS NOT TRUE;
    IF v_measures IS NOT NULL AND jsonb_array_length(v_measures) > 0 THEN
      NEW.enrollment_work_measures := v_measures;
    END IF;
  END IF;

  IF NEW.building_id IS NOT NULL THEN
    SELECT ira_confirmation_code_lea INTO v_code FROM buildings WHERE id = NEW.building_id;
    IF NEW.enrollment_income_level IS NULL AND v_code IS NOT NULL THEN
      IF v_code ILIKE 'LEA%' THEN
        NEW.enrollment_income_level := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='income_level' AND picklist_value='Low-Income' AND picklist_is_active LIMIT 1);
      ELSIF v_code ILIKE 'MEA%' THEN
        NEW.enrollment_income_level := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='income_level' AND picklist_value='Moderate' AND picklist_is_active LIMIT 1);
      END IF;
    END IF;
    IF NEW.enrollment_occupied_units IS NULL THEN
      NEW.enrollment_occupied_units := (SELECT building_total_units FROM buildings WHERE id = NEW.building_id);
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- The guard. Reads the trigger's own source, so it can never fall out of step
-- with the list it checks -- which is the failure being fixed here.
CREATE OR REPLACE FUNCTION public.find_unresolvable_reservation_defaults()
RETURNS TABLE(default_kind text, default_field text, default_value text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_src text;
  m     text[];
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.proname = 'set_enrollment_reservation_defaults'
     AND p.pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'set_enrollment_reservation_defaults does not exist';
  END IF;

  FOR m IN
    SELECT regexp_matches(v_src, 'picklist_field\s*=\s*''([^'']+)''\s+AND\s+picklist_value\s*=\s*''([^'']+)''', 'g')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM picklist_values pv
                    WHERE pv.picklist_object='enrollments'
                      AND pv.picklist_field = m[1]
                      AND pv.picklist_value = m[2]
                      AND pv.picklist_is_active) THEN
      default_kind := 'picklist'; default_field := m[1]; default_value := m[2];
      RETURN NEXT;
    END IF;
  END LOOP;

  FOR m IN SELECT regexp_matches(v_src, 'account_name\s*=\s*''([^'']+)''', 'g') LOOP
    IF NOT EXISTS (SELECT 1 FROM accounts a
                    WHERE a.account_name = m[1] AND a.account_is_deleted IS NOT TRUE) THEN
      default_kind := 'account'; default_field := NULL; default_value := m[1];
      RETURN NEXT;
    END IF;
  END LOOP;

  FOR m IN SELECT regexp_matches(v_src, 'user_email\s*=\s*''([^'']+)''', 'g') LOOP
    IF NOT EXISTS (SELECT 1 FROM users u
                    WHERE u.user_email = m[1] AND u.user_is_deleted IS NOT TRUE AND u.user_is_active) THEN
      default_kind := 'user'; default_field := NULL; default_value := m[1];
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END
$function$;

COMMENT ON FUNCTION public.find_unresolvable_reservation_defaults() IS
  'Every literal picklist value, account name and user email that set_enrollment_reservation_defaults names but which no longer resolves. Must return zero rows: a row here is a default that is silently writing NULL. Reads the trigger source so there is no second list to maintain.';

-- Ops diagnostic, not an API. Revoked, so it adds no advisor lint.
REVOKE ALL ON FUNCTION public.find_unresolvable_reservation_defaults() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_unresolvable_reservation_defaults() FROM anon;
REVOKE ALL ON FUNCTION public.find_unresolvable_reservation_defaults() FROM authenticated;

DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s %s=%s', default_kind, COALESCE(default_field,'-'), default_value), '; ')
    INTO v_bad FROM public.find_unresolvable_reservation_defaults();
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Reservation defaults still name values that do not resolve: %', v_bad;
  END IF;
END $$;

-- Backfill the blanks the broken lookup and the missing defaults left behind.
-- Fill-blank-only: ENR-00052 and ENR-00062 name Brittin Wood as the submitter,
-- entered by a person, and keep it.
DO $$
DECLARE
  v_bpt integer; v_ms integer; v_sb integer; v_other text;
BEGIN
  SET LOCAL session_replication_role = replica;

  UPDATE enrollments e SET enrollment_building_project_type = (
      SELECT id FROM picklist_values WHERE picklist_object='enrollments'
        AND picklist_field='building_project_type' AND picklist_value='Multifamily - Central 5+ Units'
        AND picklist_is_active LIMIT 1)
    FROM picklist_values rt
   WHERE rt.id = e.enrollment_record_type AND rt.picklist_value ILIKE '%Project-Reservation%'
     AND e.enrollment_is_deleted IS NOT TRUE AND e.enrollment_building_project_type IS NULL;
  GET DIAGNOSTICS v_bpt = ROW_COUNT;

  UPDATE enrollments e SET enrollment_modeling_software = (
      SELECT id FROM picklist_values WHERE picklist_object='enrollments'
        AND picklist_field='modeling_software' AND picklist_value='Energy Plus'
        AND picklist_is_active LIMIT 1)
    FROM picklist_values rt
   WHERE rt.id = e.enrollment_record_type AND rt.picklist_value ILIKE '%HOMES-Project-Reservation%'
     AND e.enrollment_is_deleted IS NOT TRUE AND e.enrollment_modeling_software IS NULL;
  GET DIAGNOSTICS v_ms = ROW_COUNT;

  UPDATE enrollments e SET enrollment_submitted_by = (
      SELECT id FROM users WHERE user_email='lucas.wood@ees-wi.org'
        AND user_is_deleted IS NOT TRUE AND user_is_active LIMIT 1)
    FROM picklist_values rt
   WHERE rt.id = e.enrollment_record_type AND rt.picklist_value ILIKE '%Project-Reservation%'
     AND e.enrollment_is_deleted IS NOT TRUE AND e.enrollment_submitted_by IS NULL;
  GET DIAGNOSTICS v_sb = ROW_COUNT;

  SET LOCAL session_replication_role = origin;

  SELECT string_agg(e.enrollment_record_number || ' (' || u.user_first_name || ' ' || u.user_last_name || ')', ', '
                    ORDER BY e.enrollment_record_number)
    INTO v_other
    FROM enrollments e
    JOIN picklist_values rt ON rt.id = e.enrollment_record_type
    JOIN users u ON u.id = e.enrollment_submitted_by
   WHERE rt.picklist_value ILIKE '%Project-Reservation%'
     AND e.enrollment_is_deleted IS NOT TRUE
     AND u.user_email <> 'lucas.wood@ees-wi.org';

  RAISE NOTICE 'Backfilled: building project type %, modeling software %, submitted by %. Left naming someone else: %',
    v_bpt, v_ms, v_sb, COALESCE(v_other, 'none');
END $$;
