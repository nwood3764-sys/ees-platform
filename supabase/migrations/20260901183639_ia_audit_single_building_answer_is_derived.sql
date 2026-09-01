-- "Are you requesting incentives for more than one property or unit owned by
-- the same person or entity?" is not a question anyone should be asked.
--
-- Nicholas: "There's never more than one property. It's always one building per
-- application."
--
-- It is structural, not a preference: incentive_applications.building_id is NOT
-- NULL, so an application is about exactly ONE building, always. The Focus On
-- Energy assessment application asks the question because its OTHER branch --
-- "Assessment Details - Multiple Units (up to 20)", which takes a spreadsheet of
-- assessments and a summed total -- exists for the case where one submission
-- covers several. LEAP does not file that way: one building, one application,
-- one $2,000 incentive. So on this record type the answer is derivable, and
-- leaving it blank only served to stop the pre-filled form opening.
--
-- Fills a blank ONLY. A person's own answer is never reversed -- IA-00025
-- carries a deliberate "Yes" entered before this shipped, and it stays "Yes".
-- Whether that one is right is a business call, not a migration's to make.

CREATE OR REPLACE FUNCTION public.derive_incentive_application_single_building_answer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rt text;
BEGIN
  IF NEW.ia_multiple_properties_same_owner IS NOT NULL THEN
    RETURN NEW;                       -- an answer, once given, is left alone
  END IF;

  -- Scoped to the record type whose FORM asks the question. Another programme's
  -- application may use this column to mean something its own form defines, and
  -- must not inherit this answer.
  SELECT picklist_value INTO v_rt FROM public.picklist_values WHERE id = NEW.ia_record_type;
  IF v_rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-AUDIT' THEN
    RETURN NEW;
  END IF;

  -- One building per application is enforced by building_id NOT NULL; the guard
  -- is here so that if that ever stops being true, this stops answering rather
  -- than answering wrongly.
  IF NEW.building_id IS NOT NULL THEN
    NEW.ia_multiple_properties_same_owner := false;
  END IF;

  RETURN NEW;
END
$function$;

-- Trigger function: PostgreSQL does not check EXECUTE when it FIRES a trigger,
-- so the grant is revoked -- otherwise a SECURITY DEFINER trigger function
-- becomes a callable definer function and an advisor lint.
REVOKE ALL ON FUNCTION public.derive_incentive_application_single_building_answer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.derive_incentive_application_single_building_answer() FROM anon;
REVOKE ALL ON FUNCTION public.derive_incentive_application_single_building_answer() FROM authenticated;

-- trg_3_* so it runs after trg_1_ia_inherit_from_enrollment and
-- trg_2_ia_property_owner_name, and before the trg_zz_* enforcement pair.
DROP TRIGGER IF EXISTS trg_3_ia_single_building_answer ON public.incentive_applications;
CREATE TRIGGER trg_3_ia_single_building_answer
  BEFORE INSERT OR UPDATE ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.derive_incentive_application_single_building_answer();

DO $$
DECLARE
  v_filled  integer;
  v_blank   integer;
  v_yes     text;
BEGIN
  SET LOCAL session_replication_role = replica;

  UPDATE public.incentive_applications ia
     SET ia_multiple_properties_same_owner = false
    FROM public.picklist_values rt
   WHERE rt.id = ia.ia_record_type
     AND rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND ia.ia_is_deleted IS NOT TRUE
     AND ia.ia_multiple_properties_same_owner IS NULL
     AND ia.building_id IS NOT NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;

  SET LOCAL session_replication_role = origin;

  SELECT count(*) INTO v_blank
    FROM public.incentive_applications ia
    JOIN public.picklist_values rt ON rt.id = ia.ia_record_type
   WHERE rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND ia.ia_is_deleted IS NOT TRUE
     AND ia.ia_multiple_properties_same_owner IS NULL;
  IF v_blank > 0 THEN
    RAISE EXCEPTION 'Every audit application should carry this answer; % still blank', v_blank;
  END IF;

  -- Surface, rather than silently reverse, any application that says Yes.
  SELECT string_agg(ia.ia_record_number, ', ' ORDER BY ia.ia_record_number) INTO v_yes
    FROM public.incentive_applications ia
    JOIN public.picklist_values rt ON rt.id = ia.ia_record_type
   WHERE rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND ia.ia_is_deleted IS NOT TRUE
     AND ia.ia_multiple_properties_same_owner IS TRUE;

  RAISE NOTICE 'Answered No on % application(s). Left as Yes (entered by a person, needs a human decision): %',
    v_filled, COALESCE(v_yes, 'none');
END $$;

-- HA-00192 told the reader this question would usually be the one thing left to
-- answer. It is answered for them now.
DO $$
DECLARE
  v_body text; v_new text;
BEGIN
  SELECT ha_body_markdown INTO v_body FROM public.help_articles
   WHERE ha_record_number='HA-00192' AND ha_is_deleted IS NOT TRUE;
  IF v_body IS NULL THEN RAISE EXCEPTION 'HA-00192 not found'; END IF;

  v_new := replace(v_body,
    'Answering *Are you requesting incentives for more than one property or unit owned by the same person or entity?* is usually the only one, because the pre-approval enrollment does not ask it.',
    'In practice there is rarely anything outstanding — every answer the form needs is either inherited or derived.');

  v_new := replace(v_new,
    'Never inherited, because the form asks for facts the enrollment does not hold: the HOMES follow-up question, the more-than-one-property question, the attestations and the signature.',
    E'*Are you requesting incentives for more than one property or unit owned by the same person or entity?* is **answered No for you**. It is structural, not an assumption: an application carries exactly one building (the column cannot be empty), so one application is always one property. The form asks because its other branch — Multiple Units, up to 20 — exists for submissions that cover several at once, which is not how LEAP files them. You can still change it on the record, and an answer you enter is never overwritten.\n\n'
    || 'Never inherited, because the form asks for facts the enrollment does not hold: the HOMES follow-up question, the attestations and the signature.');

  IF v_new = v_body THEN
    RAISE EXCEPTION 'HA-00192 was not changed — its wording no longer matches';
  END IF;
  IF v_new LIKE '%is usually the only one%' THEN
    RAISE EXCEPTION 'HA-00192 still says that question is the one thing left to answer';
  END IF;

  UPDATE public.help_articles SET ha_body_markdown = v_new, ha_updated_at = now()
   WHERE ha_record_number='HA-00192';
END $$;
