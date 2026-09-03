-- The completion date is handed over, not sent.
--
-- I mapped it to `typeA148` on the reasoning that the widget's value lives in a
-- plain hidden input beside the iframe, so URL prefill should reach it.
-- Nicholas tested it on the live form: it does not. The enrollment populates
-- the date, the link carries it, and the form still shows its own.
--
-- The reason is in the widget's own settings, which are in the form's HTML:
--
--   [{"name":"dateFormat","value":"m/d/y"},{"name":"todayDate","value":"Yes"}]
--
-- `todayDate: Yes` means the Date Picker stamps TODAY into that input when its
-- frame loads -- after Jotform's prefill has run. So the parameter is accepted
-- and then overwritten. That is worse than not sending it at all: the box comes
-- up holding today's date, which looks like an answer and is not one. It is
-- also why that box reads 09/02/2026 in a page saved on the 2nd.
--
-- Nothing LEAP can put in a URL wins against that, so the row stops pretending.
--
-- WHICH QUESTIONS A FORM WILL NOT TAKE FROM A URL IS A PROPERTY OF THE FORM, so
-- it is stored per field rather than special-cased in code: any target can
-- declare one, and the day Focus On Energy turns that widget setting off, this
-- is one boolean, not a deploy. The mapping and the transform STAY -- they are
-- what resolves the value and what makes the person's copy read 09/25/2026
-- rather than 2026-09-25.

ALTER TABLE public.external_form_field_map
  ADD COLUMN IF NOT EXISTS efm_url_prefillable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.external_form_field_map.efm_url_prefillable IS
  'False when the target form will not accept this answer from the prefill URL — e.g. a Jotform control_widget that stamps its own default over the query string. The value is still resolved and returned; it is kept OUT of the URL and handed to the person filing the form to enter once.';

CREATE OR REPLACE FUNCTION public.get_external_form_map(p_key text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
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
                 'option_value_map', m.efm_option_value_map,
                 'field_label',      m.efm_field_label,
                 'required',         m.efm_is_required,
                 'url_prefillable',  m.efm_url_prefillable
               ) ORDER BY m.efm_sort_order, m.efm_record_number)
        FROM public.external_form_field_map m
        WHERE m.efm_target_id = t.id AND m.efm_is_active AND m.efm_is_deleted IS NOT TRUE
      ), '[]'::jsonb)
    )
    FROM public.external_form_targets t
    WHERE t.eft_key = p_key AND t.eft_is_active AND t.eft_is_deleted IS NOT TRUE
    LIMIT 1
  ), '{}'::jsonb);
$function$;

-- A CREATE OR REPLACE keeps existing grants, but they are re-stated because a
-- later DROP/CREATE of this function would not.
REVOKE ALL ON FUNCTION public.get_external_form_map(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_form_map(text) TO authenticated, service_role;

UPDATE public.external_form_field_map m
   SET efm_url_prefillable = false
  FROM public.external_form_targets t
 WHERE t.id = m.efm_target_id
   AND t.eft_key = 'wi_ira_mf_hear_project_reservation'
   AND m.efm_is_deleted IS NOT TRUE
   AND m.efm_leap_field = 'estimated_completion_date';

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_off int; v_on int; v_all_on int;
BEGIN
  SELECT count(*) FILTER (WHERE m.efm_url_prefillable IS FALSE),
         count(*) FILTER (WHERE m.efm_url_prefillable IS NOT FALSE)
    INTO v_off, v_on
    FROM public.external_form_field_map m
    JOIN public.external_form_targets t ON t.id = m.efm_target_id
   WHERE t.eft_key = 'wi_ira_mf_hear_project_reservation' AND m.efm_is_deleted IS NOT TRUE;

  -- Exactly one question is handed over, and the other 46 still go in the URL.
  -- A slip here empties the form, so it is counted rather than trusted.
  IF v_off <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one hand-over field on the HEAR map, found %', v_off;
  END IF;
  IF v_on <> 46 THEN
    RAISE EXCEPTION 'Expected 46 URL-filled parameters on the HEAR map, found %', v_on;
  END IF;

  -- And no OTHER form lost a parameter to the new column's default.
  SELECT count(*) INTO v_all_on
    FROM public.external_form_field_map m
    JOIN public.external_form_targets t ON t.id = m.efm_target_id
   WHERE t.eft_key <> 'wi_ira_mf_hear_project_reservation'
     AND m.efm_is_deleted IS NOT TRUE AND m.efm_url_prefillable IS FALSE;
  IF v_all_on <> 0 THEN
    RAISE EXCEPTION '% parameters on other forms were marked un-prefillable', v_all_on;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.external_form_field_map m
      JOIN public.external_form_targets t ON t.id = m.efm_target_id
     WHERE t.eft_key = 'wi_ira_mf_hear_project_reservation'
       AND m.efm_is_deleted IS NOT TRUE
       AND m.efm_leap_field = 'estimated_completion_date'
       AND m.efm_url_prefillable IS FALSE
       AND m.efm_value_transform = 'date_mmddyyyy'
  ) THEN
    RAISE EXCEPTION 'The completion date must keep its m/d/y transform — it is what the person is handed.';
  END IF;

  -- The map RPC has to actually carry the flag, or the client cannot act on it.
  IF NOT ((public.get_external_form_map('wi_ira_mf_hear_project_reservation')->'fields') @>
          '[{"leap_field":"estimated_completion_date","url_prefillable":false}]'::jsonb) THEN
    RAISE EXCEPTION 'get_external_form_map does not report the hand-over field.';
  END IF;
END $assert$;
