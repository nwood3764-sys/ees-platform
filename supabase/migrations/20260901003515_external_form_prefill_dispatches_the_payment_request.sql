-- Register the Project Payment Request with the shared prefill dispatcher.
-- The dispatcher is keyed by TARGET, so a third form is one more branch and no
-- new code path; the two existing branches are untouched.
CREATE OR REPLACE FUNCTION public.build_external_form_prefill(p_key text, p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_key IS NULL OR p_record_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  CASE p_key
    WHEN 'wi_ira_mf_homes_assessment_preapproval' THEN
      RETURN public.build_wi_ira_assessment_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_assessment_application' THEN
      RETURN public.build_wi_ira_assessment_application_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_project_payment_request' THEN
      RETURN public.build_wi_ira_payment_request_form_prefill(p_record_id);
    ELSE
      RETURN '{}'::jsonb;
  END CASE;
END
$function$;
