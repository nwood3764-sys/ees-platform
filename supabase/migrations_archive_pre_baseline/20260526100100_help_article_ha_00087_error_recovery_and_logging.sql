DO $$
DECLARE v_article_id uuid; v_admin uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
BEGIN
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by
  ) VALUES (
    '', 'error-recovery-and-logging',
    'What to do when you see "Something went wrong"',
    'Every uncaught runtime error in the platform is now caught, logged to the client_errors table, and shown to you with a recovery panel instead of a blank white screen. The rest of LEAP keeps working when one view breaks.',
    $body$
Before this change, an unexpected error inside any module would blank the entire screen. There was no message, no diagnostic, no path back — just a white page. That failure mode is now closed.

## What you''ll see instead

When a view hits an unexpected error, the affected area of the screen shows an error panel with:

- **A clear heading** — "Something went wrong" with the name of the broken view.
- **The actual error** — the exception type and message, surfaced in plain text.
- **A reference code** — a CE-NNNNN identifier you can share with an admin. Every error is logged to the `client_errors` table the moment it happens, so this code uniquely identifies what failed and when.
- **Three actions** — *Try again* re-mounts the broken view, *Reload page* does a hard browser reload, *Copy details* puts the full diagnostic (reference, URL, time, user agent, stack trace, component stack) on your clipboard for pasting into a message.
- **An expandable technical details panel** — for when you want to see the full stack trace yourself.

The sidebar, topbar, and the rest of the platform stay alive while this panel is visible. You can navigate to another module immediately; the broken view doesn''t lock the whole app.

## What gets logged

Every caught error writes one row to `client_errors` with:

- Error name, message, full stack trace, and React component stack
- The active module and route at the time of the failure
- The current record table and id, when a record detail was open
- App user id, auth user id, email
- Browser user agent, viewport size, build version
- A session id that groups errors from the same browser tab visit

Two layers catch errors. **React error boundaries** wrap every lazy module and the top-level chrome — they catch exceptions thrown during render. **Window-level handlers** catch uncaught errors in async callbacks (timers, fetch chains, unhandled promise rejections) that the React boundary cannot see. Together they cover both synchronous and asynchronous failures.

## Auto-recovery on navigation

The per-module error boundary tracks the active module and the currently-open record. When either changes, the error state clears automatically — so navigating away from a broken record is enough to recover. You only need to hit *Try again* if you want to retry the same view.

## Admin triage

Admins can review every client error from Setup → Data → Client Errors (forthcoming view; the table is queryable directly in the meantime). The triage workflow uses the `ce_resolved`, `ce_resolved_by`, `ce_resolved_at`, and `ce_resolution_notes` columns to track which errors have been investigated.

## What this means for stability

White-screen failures used to look like total outages because there was no isolation between modules — one bad render anywhere unmounted the entire React tree. The new structure means an error in the Field module does not affect Dispatch, Stock, or anything else. A bad record in one table cannot blank out the rest of the application.

The reference code system also means triage no longer depends on a user being able to describe what they saw. The full diagnostic context is captured automatically the moment the failure happens.
$body$,
    'platform',
    'all',
    true,
    v_admin,
    v_admin
  )
  RETURNING id INTO v_article_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'object', 'client_errors',  10, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'error-recovery',      20, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'error-boundary',      30, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'client-errors',       40, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'stability',           50, v_admin);
  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order, haa_created_by)
    VALUES (v_article_id, 'concept', 'white-screen',        60, v_admin);

  IF (SELECT COUNT(*) FROM public.help_article_anchors WHERE haa_article_id = v_article_id) <> 6 THEN
    RAISE EXCEPTION 'expected 6 anchors for HA-00087 error-recovery-and-logging, got %', (SELECT COUNT(*) FROM public.help_article_anchors WHERE haa_article_id = v_article_id);
  END IF;
END $$;
