-- The payment request's prefill parameters were the form's INPUT names, not its
-- prefill names, so the URL opened the Jotform and populated nothing.
--
-- Jotform names an input q{questionId}_{uniqueName} -- q65_doesThe65 is
-- question 65, unique name doesThe65 -- and prefills on the UNIQUE NAME alone.
-- The q-prefixed string is what the form POSTs back, which is exactly what made
-- it look authoritative when it was read out of the saved form HTML.
--
-- Formstack, which the other two targets use, prefills on its raw field id
-- (field188466720), so nothing in the existing maps hinted at the difference.
-- The provider is already stored on the target; this is the first place it
-- changes how a parameter is written.
--
-- Compound fields keep their bracket suffix -- primaryContractor[first],
-- phoneNumber46[full], installationAddress[city] -- because the bracket belongs
-- to the sub-field's name, not to the q-prefix.

UPDATE public.external_form_field_map m
SET efm_external_param = regexp_replace(m.efm_external_param, '^q[0-9]+_', '')
FROM public.external_form_targets t
WHERE t.id = m.efm_target_id
  AND t.eft_key = 'wi_ira_mf_homes_project_payment_request'
  AND t.eft_form_provider = 'jotform'
  AND m.efm_is_deleted IS NOT TRUE
  AND m.efm_external_param ~ '^q[0-9]+_';

DO $$
DECLARE v_left integer; v_sample text;
BEGIN
  SELECT count(*) INTO v_left
  FROM public.external_form_field_map m
  JOIN public.external_form_targets t ON t.id = m.efm_target_id
  WHERE t.eft_key = 'wi_ira_mf_homes_project_payment_request'
    AND m.efm_is_deleted IS NOT TRUE
    AND m.efm_external_param ~ '^q[0-9]+_';
  IF v_left > 0 THEN
    RAISE EXCEPTION '% parameter(s) still carry the q-prefix', v_left;
  END IF;

  -- The Formstack targets must be untouched: their ids legitimately look
  -- nothing like this, but a future careless sweep is what this guards against.
  SELECT string_agg(DISTINCT m.efm_external_param, ', ') INTO v_sample
  FROM public.external_form_field_map m
  JOIN public.external_form_targets t ON t.id = m.efm_target_id
  WHERE t.eft_form_provider = 'formstack' AND m.efm_is_deleted IS NOT TRUE
    AND m.efm_external_param NOT LIKE 'field%';
  IF v_sample IS NOT NULL THEN
    RAISE EXCEPTION 'A Formstack parameter was rewritten: %', v_sample;
  END IF;
END $$;
