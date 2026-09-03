-- The HEAR Project Reservation button opened the HOMES form.
--
-- Nicholas, 2026-09-02: "The project reservation application is opening the
-- HOMES job form" -- i.e. the HEAR record type must open the HEAR form. The
-- target row exists and is correctly scoped to WI-IRA-MF-HEAR-Project-
-- Reservation; it was simply created carrying the HOMES form's URL
-- (250306438751960), which three of the five targets shared.
--
-- Correct for the HOMES reservation and the HOMES payment request, since those
-- genuinely are that one Project Submittal Form. Wrong for HEAR, which is its
-- own form: 251176242544858.
--
-- THE FIELD MAP IS NOT CORRECTED HERE, and that is deliberate. Its 23 rows are
-- a byte-for-byte copy of the HOMES map -- imApplying, buildingType255,
-- primaryContractor28 -- which are the HOMES form's parameter names. A
-- different Jotform has different ones, so those parameters will be ignored and
-- the form opens empty. That is the RIGHT failure while the mapping is unknown:
-- an empty HEAR form is a form somebody fills in, whereas the HOMES form was a
-- wrong document that looked populated and correct.
--
-- Every row is left in place rather than deleted, so re-mapping is an edit of
-- known rows against the real form rather than a rebuild from nothing.

UPDATE public.external_form_targets
   SET eft_base_url = 'https://focusonenergy.jotform.com/251176242544858',
       eft_external_form_id = '251176242544858',
       eft_notes = concat_ws(E'\n', eft_notes,
         'Repointed 2026-09-02 from the HOMES form (250306438751960), which this row was created carrying. The field map is still the HOMES map and its parameter names do not exist on this form, so the form opens empty until it is re-mapped against the real HEAR form.')
 WHERE eft_key = 'wi_ira_mf_hear_project_reservation'
   AND eft_is_deleted IS NOT TRUE;

DO $$
DECLARE v_url text; v_homes text;
BEGIN
  SELECT eft_base_url INTO v_url FROM public.external_form_targets
   WHERE eft_key = 'wi_ira_mf_hear_project_reservation' AND eft_is_deleted IS NOT TRUE;
  IF v_url <> 'https://focusonenergy.jotform.com/251176242544858' THEN
    RAISE EXCEPTION 'the HEAR target did not take the new URL, it reads %', v_url;
  END IF;

  -- The two targets that legitimately share the Project Submittal Form must be
  -- untouched: this change is about HEAR only.
  SELECT string_agg(eft_key, ', ' ORDER BY eft_key) INTO v_homes
  FROM public.external_form_targets
  WHERE eft_is_deleted IS NOT TRUE
    AND eft_base_url = 'https://focusonenergy.jotform.com/250306438751960';
  IF v_homes IS DISTINCT FROM 'wi_ira_mf_homes_project_payment_request, wi_ira_mf_homes_project_reservation'
  THEN
    RAISE EXCEPTION 'the HOMES targets changed; expected exactly the two HOMES forms, got: %', v_homes;
  END IF;
END $$;
