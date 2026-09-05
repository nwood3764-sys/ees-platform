-- ===========================================================================
-- HA-00215 corrected in place: Year Built is a dropdown on every object that
-- has one, not only on a building.
--
-- Corrected, not appended to.  The article shipped hours earlier saying "on a
-- building record", and a help article that describes a narrower rule than the
-- platform enforces sends a reader looking for a screen that does not behave
-- the way they were told.
-- ===========================================================================
update public.help_articles
   set ha_title = 'Building Type, Stories and Year Built',
       ha_summary = 'Type fills itself in on a multifamily building, and Year Built and Stories are chosen from a list instead of typed.',
       ha_body_markdown = replace(
         ha_body_markdown,
         '## Stories and Year Built are chosen, not typed',
         '## Year Built is a dropdown everywhere

Every object that records the year a building was built offers the same list:
**buildings**, **properties**, **assessments**, **opportunities** and the
**Manual J report**.  One rule, one list, so the same field never behaves two
ways depending on which record you opened.

Two columns deliberately do NOT get the dropdown, because nobody chooses them:
a property''s **Average Building Year Built** is an average across its buildings
(and can legitimately be a fraction), and the HUD **earliest construction year**
is an aggregate the import works out.

## Stories and Year Built are chosen, not typed'),
       ha_updated_at = now()
 where ha_slug = 'building-type-stories-and-year-built'
   and ha_is_deleted is not true;

do $$
DECLARE v_body text;
BEGIN
  SELECT ha_body_markdown INTO v_body FROM public.help_articles
   WHERE ha_slug='building-type-stories-and-year-built' AND ha_is_deleted IS NOT TRUE;
  IF v_body IS NULL THEN RAISE EXCEPTION 'HA-00215 is missing'; END IF;
  IF position('Year Built is a dropdown everywhere' in v_body) = 0 THEN
    RAISE EXCEPTION 'the correction did not land';
  END IF;
  -- CONTROL: the article must now name the other four objects, or it is still
  -- describing a buildings-only rule.
  IF position('assessments' in v_body) = 0 OR position('Manual J' in v_body) = 0 THEN
    RAISE EXCEPTION 'the article still describes a buildings-only rule';
  END IF;
END $$;
