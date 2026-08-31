-- HA-00169 and HA-00157 both said Property Owner Name "comes from the property's
-- owner organization" — true only of the HUD import column, which is blank on
-- every property created in LEAP by hand. That sent anyone hitting the
-- completeness check to the one field on the property that was already correct.
-- Corrected in place (both sources named, in the order the prefill reads them),
-- not appended: the old sentence was wrong, not merely incomplete.

UPDATE public.help_articles
SET ha_body_markdown = replace(
      ha_body_markdown,
      '- **Property Owner Name** comes from the property''s owner organization.',
      '- **Property Owner Name** comes from the property''s **HUD Owner Organization**, or — when that is blank, as it is on any property not created by the HUD import — from the property''s **Property Owner** account.'
    )
WHERE ha_record_number = 'HA-00169'
  AND ha_is_deleted IS NOT TRUE;

UPDATE public.help_articles
SET ha_body_markdown = replace(
      ha_body_markdown,
      '| Property Owner Name | The property''s owner organization |',
      '| Property Owner Name | The property''s HUD Owner Organization, else its **Property Owner** account |'
    )
WHERE ha_record_number = 'HA-00157'
  AND ha_is_deleted IS NOT TRUE;

-- Both replacements must have landed; a silent no-op leaves a wrong instruction
-- published, which is the failure this migration exists to prevent.
DO $$
DECLARE v_stale integer;
BEGIN
  SELECT count(*) INTO v_stale
  FROM public.help_articles
  WHERE ha_is_deleted IS NOT TRUE
    AND ha_record_number IN ('HA-00169', 'HA-00157')
    AND ha_body_markdown LIKE '%property''s owner organization%';
  IF v_stale > 0 THEN
    RAISE EXCEPTION 'Help article text not updated on % article(s)', v_stale;
  END IF;
END $$;
