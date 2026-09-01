-- Two values the Jotform would have rejected, found by assembling the real
-- prefill URL and reading it against the form's own option lists rather than
-- assuming the map was right because it was complete.
--
-- 1. "Multifamily - Central 5 Units" is LEAP's transcription of the form's
--    "Multifamily - Central 5+ Units" -- the plus was dropped. A dropdown
--    prefill only selects on an exact match, so that field silently stayed
--    empty. Corrected on BOTH objects, because picklist_value_translate maps
--    the reservation's value to the application's BY THE VALUE STRING: fixing
--    one and not the other would break the carry-forward that fills this field
--    in the first place. Renaming is safe -- records reference the row by id.
--
-- 2. The contractor and payment-mailing states were sent as stored:
--    "Wisconsin" for EES-WI, "WI" for Sealed Inc. The form's state dropdown
--    takes the two-letter code. The state_2letter transform already exists for
--    exactly this (the pre-approval map uses it) and passes a value already
--    abbreviated straight through, so it fixes the long form without touching
--    the short one. The installation address needs no transform -- it comes
--    from properties.property_state, which is always the code.

UPDATE public.picklist_values
SET picklist_value = 'Multifamily - Central 5+ Units',
    picklist_label = CASE WHEN picklist_label = 'Multifamily - Central 5 Units'
                          THEN 'Multifamily - Central 5+ Units' ELSE picklist_label END
WHERE picklist_field = 'building_project_type'
  AND picklist_value = 'Multifamily - Central 5 Units'
  AND picklist_object IN ('enrollments','incentive_applications');

UPDATE public.external_form_field_map m
SET efm_value_transform = 'state_2letter'
FROM public.external_form_targets t
WHERE t.id = m.efm_target_id
  AND t.eft_key = 'wi_ira_mf_homes_project_payment_request'
  AND m.efm_is_deleted IS NOT TRUE
  AND m.efm_leap_field IN ('contractor_state','payment_mailing_state');

DO $$
DECLARE v_bad text; v_untransformed integer;
BEGIN
  SELECT string_agg(picklist_object || '=' || picklist_value, ', ') INTO v_bad
  FROM public.picklist_values
  WHERE picklist_field='building_project_type' AND picklist_is_active
    AND picklist_value LIKE '%Central 5%'
    AND picklist_value <> 'Multifamily - Central 5+ Units';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Still disagrees with the form: %', v_bad;
  END IF;

  IF (SELECT count(DISTINCT picklist_value) FROM public.picklist_values
       WHERE picklist_field='building_project_type' AND picklist_is_active
         AND picklist_value LIKE '%Central 5%') <> 1 THEN
    RAISE EXCEPTION 'The two objects no longer share one value string, so picklist_value_translate will miss';
  END IF;

  SELECT count(*) INTO v_untransformed
  FROM public.external_form_field_map m
  JOIN public.external_form_targets t ON t.id=m.efm_target_id
  WHERE t.eft_key='wi_ira_mf_homes_project_payment_request' AND m.efm_is_deleted IS NOT TRUE
    AND m.efm_leap_field IN ('contractor_state','payment_mailing_state')
    AND COALESCE(m.efm_value_transform,'') <> 'state_2letter';
  IF v_untransformed > 0 THEN
    RAISE EXCEPTION '% state field(s) still send the stored spelling', v_untransformed;
  END IF;
END $$;
