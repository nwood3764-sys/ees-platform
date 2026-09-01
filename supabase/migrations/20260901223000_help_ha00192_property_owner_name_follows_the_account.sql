-- HA-00192 told the reader the wrong rule, which is worse than telling them a
-- stale one: it said LEAP takes the HUD owner organization first and fills the
-- field in when the record is created. Both halves stopped being true with
-- 20260901221600 -- the name comes from the property's Owner Account and keeps
-- following it -- and the article never mentioned the two things a user now
-- needs to know: that editing it stops the inheritance, and that clearing it
-- starts it again. Corrected in place, not appended.

DO $$
DECLARE
  v_old text := 'A property states its owner in two places and either one may be the only one filled in: the HUD owner organization, and the Property Owner **account**. LEAP takes the HUD name where there is one — it names the entity that owns *that* property, which can be narrower than the account (LSS HOUSING, INC. under the parent Lutheran Social Services of Wisconsin and Upper Michigan, Inc.) — and the account name otherwise. Because it is the application''s own field you can also **edit it**, which matters when a particular application has to go out under a different name.';
  v_new text := 'The owner of a property is recorded in exactly one place — the **Property Account** on the property record — and that is where this name comes from. It is not a snapshot taken when the application was created: correct the owner on the property, or rename that account, and every application follows. (The property''s **HUD owner organization** is what the HUD file said when the property was imported, and it is no longer used here — it can name a previous owner. Where it names a narrower entity than the account, such as LSS HOUSING, INC. under the parent Lutheran Social Services of Wisconsin and Upper Michigan, Inc., point the property at that narrower account rather than leaving the two disagreeing.) Because it is the application''s own field you can still **edit it** when a particular application has to go out under a different name — from then on that application keeps your name and stops following the account. **Clear the field to go back to following the account.** An application whose status locks the record — Submitted, Approved, Denied or Withdrawn — is never rewritten either way: the name on a submitted application is the name that was submitted.';
  v_hit integer;
BEGIN
  SELECT count(*) INTO v_hit FROM public.help_articles
   WHERE ha_record_number = 'HA-00192' AND ha_is_deleted IS NOT TRUE
     AND position(v_old in ha_body_markdown) > 0;
  IF v_hit <> 1 THEN
    RAISE EXCEPTION 'HA-00192 does not carry the paragraph this migration corrects (matched % article(s))', v_hit;
  END IF;

  UPDATE public.help_articles
     SET ha_body_markdown = replace(
           replace(ha_body_markdown, v_old, v_new),
           '**Property Owner Name is the application''s own field**, filled in for you when the record is created.',
           '**Property Owner Name is the application''s own field, and it follows the property''s Owner Account.**')
   WHERE ha_record_number = 'HA-00192' AND ha_is_deleted IS NOT TRUE;

  SELECT count(*) INTO v_hit FROM public.help_articles
   WHERE ha_record_number = 'HA-00192' AND ha_is_deleted IS NOT TRUE
     AND (position('LEAP takes the HUD name where there is one' in ha_body_markdown) > 0
          OR position('filled in for you when the record is created' in ha_body_markdown) > 0);
  IF v_hit > 0 THEN
    RAISE EXCEPTION 'the old Property Owner Name wording survived the correction';
  END IF;

  SELECT count(*) INTO v_hit FROM public.help_articles
   WHERE ha_record_number = 'HA-00192' AND ha_is_deleted IS NOT TRUE
     AND position('Clear the field to go back to following the account' in ha_body_markdown) > 0;
  IF v_hit <> 1 THEN
    RAISE EXCEPTION 'the corrected wording did not land';
  END IF;
END $$;
