-- =============================================================================
-- The Communications help is findable: anchored to every record that has the
-- card, and filed under one category.
--
-- Nicholas, 2026-09-03: "Make sure you have the help index so users understand
-- this and can search and learn how to use this."
--
-- WHAT WAS WRONG. Writing the article was not the same as indexing it.
--
--   1. HA-00208 (Communications on enrollments and incentives) had ZERO
--      anchors, and so did HA-00154 (logging an email from Outlook). An
--      article with no anchors never appears when a user presses ? on the
--      record it is about — the help panel looks articles up by the object
--      the user is looking at (useCurrentPageAnchors emits
--      {type:'object', object:<table>}). Both were reachable only by
--      knowing to search for them.
--
--   2. HA-00078, the general card article, carried SEVEN object anchors —
--      the set of objects that had the card when it was written. Press ? on
--      an enrollment, a unit, a service appointment, an account or a
--      contact and the platform had nothing to say about the card sitting
--      on the page.
--
--   3. The help centre's table of contents groups by the RAW category
--      string, so `communications` (HA-00078) and `Communications` (20
--      articles) were two separate headings. LEAP Pad's knowledge base
--      normalises the casing and grouped them together — one question, two
--      answers, and a reader on the desktop who opened "Communications"
--      saw 20 of the 21 articles.
--
-- The anchors below are GENERATED from conversation_anchor_columns(), the
-- same registry the card, the feed and the add-in read. An object that gains
-- a Communications card gains its help with no edit here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. One category per subject, so the index has one heading per subject.
--
-- Only case-collisions are merged — two spellings of one category. Where two
-- DIFFERENT words are used for a similar idea ("Admin" vs "Administration",
-- "List Views" vs "Lists and views") that is an editorial call, not a
-- mechanical one, and is left alone.
-- -----------------------------------------------------------------------------
UPDATE public.help_articles a
   SET ha_category = canon.ha_category
  FROM (
    SELECT lower(ha_category) AS key,
           -- The spelling most articles already use wins; ties break toward
           -- the capitalised form.
           (array_agg(ha_category ORDER BY n DESC, (ha_category = initcap(ha_category)) DESC))[1] AS ha_category
    FROM (
      SELECT ha_category, count(*) AS n
      FROM public.help_articles
      WHERE ha_is_deleted = false AND ha_category IS NOT NULL
      GROUP BY ha_category
    ) counted
    GROUP BY lower(ha_category)
    HAVING count(*) > 1
  ) canon
 WHERE a.ha_is_deleted = false
   AND lower(a.ha_category) = canon.key
   AND a.ha_category <> canon.ha_category;

-- A lowercase stray with no twin still reads as a mistake in a list of
-- headings. Title-case the single-word ones.
UPDATE public.help_articles
   SET ha_category = initcap(ha_category)
 WHERE ha_is_deleted = false
   AND ha_category IS NOT NULL
   AND ha_category = lower(ha_category)
   AND ha_category !~ ' ';

-- -----------------------------------------------------------------------------
-- 2. Anchor the three Communications articles to the records they describe.
-- -----------------------------------------------------------------------------

-- Replace the object anchors on the articles this migration owns, so the
-- generated set is the whole truth rather than an addition to a stale one.
DELETE FROM public.help_article_anchors
 WHERE haa_anchor_type = 'object'
   AND haa_article_id IN (
     SELECT id FROM public.help_articles
     WHERE ha_record_number IN ('HA-00078', 'HA-00154', 'HA-00208')
   );

-- HA-00078 — the general card article — and HA-00154 — filing an email from
-- Outlook — apply to every object that can hold a thread.
INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order)
SELECT a.id, 'object', reg.object_name, row_number() OVER (PARTITION BY a.id ORDER BY reg.object_name)
FROM public.help_articles a
CROSS JOIN public.conversation_anchor_columns() reg
WHERE a.ha_record_number IN ('HA-00078', 'HA-00154');

-- The thread itself is a record someone can open.
INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order)
SELECT a.id, 'object', 'conversations', 99
FROM public.help_articles a
WHERE a.ha_record_number = 'HA-00078';

-- HA-00208 is about the two objects that just got the card.
INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order)
SELECT a.id, 'object', o.object_name, o.ord
FROM public.help_articles a
CROSS JOIN (VALUES ('enrollments', 1), ('incentive_applications', 2)) AS o(object_name, ord)
WHERE a.ha_record_number = 'HA-00208';

-- Concepts: what a person calls the thing they are trying to do.
DELETE FROM public.help_article_anchors
 WHERE haa_anchor_type = 'concept'
   AND haa_concept IN ('communications-card', 'log-a-call', 'log-email-from-outlook', 'file-an-email')
   AND haa_article_id IN (
     SELECT id FROM public.help_articles
     WHERE ha_record_number IN ('HA-00078', 'HA-00154', 'HA-00208')
   );

INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order)
SELECT a.id, 'concept', c.concept, c.ord
FROM public.help_articles a
JOIN (VALUES
  ('HA-00078', 'communications-card',    101),
  ('HA-00078', 'log-a-call',             102),
  ('HA-00208', 'communications-card',    101),
  ('HA-00208', 'log-a-call',             102),
  ('HA-00154', 'log-email-from-outlook', 101),
  ('HA-00154', 'file-an-email',          102)
) AS c(rec, concept, ord) ON c.rec = a.ha_record_number;

-- -----------------------------------------------------------------------------
-- 3. Prove a reader can actually get to it.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE
  v_n     int;
  v_miss  text;
BEGIN
  -- Every object that can hold a thread has help behind the ? button.
  SELECT string_agg(reg.object_name, ', ' ORDER BY reg.object_name) INTO v_miss
  FROM public.conversation_anchor_columns() reg
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.help_article_anchors an
    JOIN public.help_articles a ON a.id = an.haa_article_id
    WHERE an.haa_anchor_type = 'object'
      AND an.haa_object = reg.object_name
      AND a.ha_is_deleted = false
      AND a.ha_is_published = true
  );
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION 'no published help article is anchored to: %', v_miss;
  END IF;

  -- The two articles that had none now have some.
  FOR v_miss IN SELECT unnest(ARRAY['HA-00208','HA-00154','HA-00078']) LOOP
    SELECT count(*) INTO v_n
    FROM public.help_article_anchors an
    JOIN public.help_articles a ON a.id = an.haa_article_id
    WHERE a.ha_record_number = v_miss;
    IF v_n = 0 THEN
      RAISE EXCEPTION '% still has no anchors, so it only surfaces if somebody searches for it', v_miss;
    END IF;
  END LOOP;

  -- Searching the words a person would actually type finds the article.
  SELECT count(*) INTO v_n FROM public.help_search_articles('communications enrollment', NULL, 20);
  IF v_n = 0 THEN RAISE EXCEPTION 'searching "communications enrollment" finds nothing'; END IF;
  SELECT count(*) INTO v_n FROM public.help_search_articles('log a call', NULL, 20);
  IF v_n = 0 THEN RAISE EXCEPTION 'searching "log a call" finds nothing'; END IF;
  SELECT count(*) INTO v_n FROM public.help_search_articles('incentive', NULL, 20);
  IF v_n = 0 THEN RAISE EXCEPTION 'searching "incentive" finds nothing'; END IF;

  -- Looking up the enrollment object — what the ? button does on an
  -- enrollment record — returns the card's article.
  SELECT count(*) INTO v_n
  FROM public.help_lookup_articles('[{"type":"object","object":"enrollments"}]'::jsonb, NULL);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'pressing ? on an enrollment still offers no help';
  END IF;

  -- The index has one heading per subject.
  SELECT count(*) INTO v_n FROM (
    SELECT lower(ha_category) FROM public.help_articles
    WHERE ha_is_deleted = false AND ha_category IS NOT NULL
    GROUP BY lower(ha_category) HAVING count(DISTINCT ha_category) > 1
  ) dupes;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% help categor(ies) are still spelled two ways', v_n;
  END IF;
END
$do$;
