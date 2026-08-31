-- HA-00192: the article's opening promise -- "you fill the record top to bottom
-- and then key it across" -- is the behaviour that just changed. There is a
-- button now.

DO $$
DECLARE
  v_body text; v_new text;
BEGIN
  SELECT ha_body_markdown INTO v_body FROM public.help_articles
   WHERE ha_record_number='HA-00192' AND ha_is_deleted IS NOT TRUE;
  IF v_body IS NULL THEN RAISE EXCEPTION 'HA-00192 not found'; END IF;

  v_new := replace(v_body,
    'Its page is laid out section for section against the live form, so you fill the record top to bottom and then key it across.',
    'Its page is laid out section for section against the live form. Fill the record top to bottom, then **Actions → Open Assessment Application**: the Focus On Energy form opens in a new tab with LEAP''s answers already in it.');

  v_new := replace(v_new,
    '**Actions → Verify Fields** checks both halves',
    E'## Open Assessment Application\n\n'
    || E'**Actions → Open Assessment Application** opens focusonenergy.formstack.com/forms/ira_assessment_app pre-filled from this record — 27 of the form''s answers, including the assessment address, the assessor''s office and payment addresses, the modelled-as and modelling-software choices, the dates and both dollar figures. You review it, attach the three files, affirm the five statements and sign.\n\n'
    || E'Three things it will not do, each on purpose:\n\n'
    || E'- **It will not open a half-filled form.** If a field the program marks required is still blank on the record, LEAP lists what is outstanding instead of opening the tab. Answering *Are you requesting incentives for more than one property or unit owned by the same person or entity?* is usually the only one, because the pre-approval enrollment does not ask it.\n'
    || E'- **It will not tick the attestations or sign for you.** Those five statements and the digital signature are a certification a person makes; LEAP pre-ticking one would be a forgery, not a convenience.\n'
    || E'- **It cannot carry the files.** No URL can. Attach the Asset Score, BuildingSync file and invoice on the form itself — they are on the record''s Details tab, ready to hand.\n\n'
    || E'The form is **conditional**: "How was the building modeled?" chooses between a single-family branch, this multifamily one, and a multiple-units branch, and only the multifamily branch is wired — which is why the button is on WI-IRA-MF-HOMES-AUDIT and nothing else. A single-family audit application would get its own form target, never a widening of this one.\n\n'
    || '**Actions → Verify Fields** checks both halves');

  IF v_new = v_body THEN
    RAISE EXCEPTION 'HA-00192 was not changed — its wording no longer matches';
  END IF;
  IF v_new LIKE '%then key it across.%' THEN
    RAISE EXCEPTION 'HA-00192 still says the application is keyed across by hand';
  END IF;
  IF v_new NOT LIKE '%Open Assessment Application%' THEN
    RAISE EXCEPTION 'HA-00192 does not describe the new action';
  END IF;

  UPDATE public.help_articles SET ha_body_markdown = v_new, ha_updated_at = now()
   WHERE ha_record_number='HA-00192';
END $$;
