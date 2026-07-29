-- ─── help_search_articles_for_assistant ────────────────────────────────────
-- Purpose-built read path for the LEAP assistant (ai-assistant edge function).
--
-- The assistant could take actions and read business data, but had NO access to
-- LEAP's help-article library, so "how do I…" / "where do I find…" questions
-- (e.g. "how do I change the stages per record type for an opportunity?") fell
-- outside everything it was told it could do and it declined them.
--
-- The existing help_search_articles RPC returns article METADATA only (title,
-- summary, category) — enough to render a browse list, but not enough for the
-- assistant to actually answer a question. This function returns the same
-- ranked full-text search PLUS the article's markdown body, so the assistant
-- can read the steps and relay them.
--
-- Audience is resolved server-side from the caller's role and is NEVER supplied
-- by the client, so a portal (external) user can never read admin/internal
-- articles through the assistant. The tier hierarchy is deliberately more
-- generous than the flat single-audience Help Center match: admins and internal
-- staff both see internal + all articles (admins are internal staff), and only
-- portal roles see portal articles — because the point of the assistant is to
-- answer how-to questions, most of which are authored for internal staff.
CREATE OR REPLACE FUNCTION public.help_search_articles_for_assistant(p_query text, p_limit integer DEFAULT 5)
 RETURNS TABLE(ha_record_number text, ha_slug text, ha_title text, ha_summary text, ha_category text, ha_audience text, ha_body_markdown text, match_rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role_name text;
  v_audiences text[];
  v_has_query boolean := (p_query IS NOT NULL AND length(trim(p_query)) > 0);
  v_tsquery   tsquery;
  v_limit     integer := GREATEST(1, LEAST(coalesce(p_limit, 5), 10));
BEGIN
  -- Resolve the caller's role → the audiences they may read.
  SELECT r.role_name INTO v_role_name
  FROM public.users u
  LEFT JOIN public.roles r ON r.id = u.role_id
  WHERE u.auth_user_id = auth.uid();

  IF v_role_name IS NULL THEN
    RETURN;  -- caller is not a resolvable LEAP user → surface nothing
  END IF;

  v_audiences := CASE
    WHEN v_role_name = 'Admin'
      THEN ARRAY['all','internal','admin']
    WHEN v_role_name IN ('Property Owner','Property Manager','Service Provider Partner')
      THEN ARRAY['all','portal']
    ELSE ARRAY['all','internal']
  END;

  IF v_has_query THEN
    v_tsquery := websearch_to_tsquery('english', p_query);
  END IF;

  RETURN QUERY
  SELECT
    a.ha_record_number, a.ha_slug, a.ha_title, a.ha_summary,
    a.ha_category, a.ha_audience, a.ha_body_markdown,
    CASE WHEN v_has_query THEN ts_rank(a.ha_search, v_tsquery) ELSE 0::real END
  FROM public.help_articles a
  WHERE a.ha_is_deleted = false
    AND a.ha_is_published = true
    AND a.ha_audience = ANY(v_audiences)
    AND (NOT v_has_query OR a.ha_search @@ v_tsquery)
  ORDER BY
    CASE WHEN v_has_query THEN ts_rank(a.ha_search, v_tsquery) ELSE 0::real END DESC,
    a.ha_title ASC
  LIMIT v_limit;
END;
$function$
;

REVOKE ALL ON FUNCTION public.help_search_articles_for_assistant(p_query text, p_limit integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.help_search_articles_for_assistant(p_query text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.help_search_articles_for_assistant(p_query text, p_limit integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.help_search_articles_for_assistant(p_query text, p_limit integer) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Help article for the new capability (HA record number assigned by
-- trg_help_articles_rn — pass '').
INSERT INTO public.help_articles (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published)
VALUES ('', 'ask-the-assistant-how-to-questions', 'Ask the LEAP Assistant how to do things',
  'The LEAP Assistant can now answer "how do I…" and "where do I find…" questions by reading LEAP''s built-in help articles — not just create records and run reports.',
$md$
## The assistant answers how-to questions now

The **LEAP Assistant** (the chat panel on every screen) does two things:

1. **Takes actions** — create a work order, update a record, change a status,
   run or build a report, look something up. It always shows you the action for
   confirmation before it runs, and only does what your permissions allow.
2. **Answers how-to questions about using LEAP** — "How do I change the stages
   per record type for an opportunity?", "Where do I add a user?", "How do I
   build a report?" It searches LEAP's **help articles** — the same library you
   can browse in the Help Center — and walks you through the steps.

## How it answers

When you ask a how-to or "where is it" question, the assistant searches the help
library for the matching articles and answers from what they actually say,
naming the exact place in the app (the Object Manager, LEAP Admin / Setup, the
Reports module, and so on) and citing the article it used.

It only sees the articles your role is allowed to see, and it will tell you
plainly when there isn't a help article covering your question rather than
guessing at a menu path — so if it can't find one, browse the **Help Center**
(the Help area) or ask your LEAP administrator.

## Tip

Phrase the question the way you'd ask a coworker — "how do I…", "where do I…",
"what's the way to…". You don't need to know the LEAP term for it; the search
matches on the words in the articles.
$md$,
  'AI Assistant', 'all', true);
