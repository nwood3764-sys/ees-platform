-- Recently Viewed home-screen component — "Recent Opportunities" (and its
-- Qualification sibling "Recent Applications") should reflect the records the
-- signed-in user has actually OPENED, newest first — not records that merely
-- changed on save/edit.
--
-- Nicholas (2026-07-30): "My recent opportunities are not updating on the
-- right-hand side… it really needs to be opportunities that I'm viewing, not
-- just save and editing." Both home cards were `list_view` components bound to a
-- saved list view sorted by `*_updated_at desc`, so they moved only when a record
-- was created or edited, never when it was simply viewed. That defeats the whole
-- point of the card: a fast way back to what you were just looking at.
--
-- The per-user view log already exists (user_recently_viewed_records, migration
-- 20260728203614) and RecordDetail already records every opened record into it.
-- This adds:
--   1. list_recently_viewed_for_object(object_table, limit) — a purpose-built
--      reader for a single-object "recently viewed" home card. It reuses the
--      existing list_recently_viewed() label resolver (one source of truth for
--      turning a footprint row into a current, RLS-scoped display label), then
--      filters to one object type.
--   2. Repoints the two live home cards from `list_view` → the new
--      `recently_viewed` component type, scoped to their object.

-- ─── Reader: my recently-viewed records of ONE object ───────────────────────
-- SECURITY INVOKER: list_recently_viewed() is itself invoker and RLS-scoped to
-- the caller, so this inherits the same guarantees. 50 covers the per-user active
-- cap, so filtering to one object never drops a row that should appear.
CREATE OR REPLACE FUNCTION public.list_recently_viewed_for_object(
  p_object_table text,
  p_limit integer DEFAULT 8
)
 RETURNS TABLE(id uuid, primary_label text, secondary_label text,
               record_number text, last_viewed_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT r.id, r.primary_label, r.secondary_label, r.record_number, r.last_viewed_at
  FROM public.list_recently_viewed(50) r
  WHERE p_object_table IS NOT NULL
    AND r.table_name = p_object_table
  ORDER BY r.last_viewed_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 8), 1)
$function$;

REVOKE ALL ON FUNCTION public.list_recently_viewed_for_object(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_recently_viewed_for_object(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_recently_viewed_for_object(text, integer) TO service_role;

-- ─── Repoint the two live "Recent …" home cards ─────────────────────────────
-- Enrollment Home → "Recent Opportunities" (opportunities).
UPDATE public.home_page_components
SET hpc_type      = 'recently_viewed',
    hpc_source_id = NULL,
    hpc_config    = COALESCE(hpc_config, '{}'::jsonb) || jsonb_build_object('objectTable', 'opportunities'),
    hpc_updated_at = now()
WHERE id = 'd43c8e16-fa3a-435b-b5cc-1ad85296522d'
  AND hpc_type = 'list_view';

-- Qualification Home → "Recent Applications" (incentive_applications) — same
-- defect, same fix, so the paired card behaves identically.
UPDATE public.home_page_components
SET hpc_type      = 'recently_viewed',
    hpc_source_id = NULL,
    hpc_config    = COALESCE(hpc_config, '{}'::jsonb) || jsonb_build_object('objectTable', 'incentive_applications'),
    hpc_updated_at = now()
WHERE id = '54874c98-1d1e-48e1-be99-d16c8aa7fd8b'
  AND hpc_type = 'list_view';

-- ─── Help article ───────────────────────────────────────────────────────────
INSERT INTO public.help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published, ha_created_by)
SELECT gen_random_uuid(), 'HA-00167', 'recently-viewed-home-card',
 'Recently Viewed cards on your Home screen',
 'Home cards like "Recent Opportunities" now list the records you have actually opened, newest first — so a record you just looked at jumps to the top even if you did not change it.',
$md$## What changed

The **Recent Opportunities** card on the Enrollment home (and **Recent Applications**
on the Qualification home) used to be ordered by *when a record was last saved or
edited*. That meant simply **viewing** a record did nothing to the list — you had to
change something for it to move to the top.

These cards are now **Recently Viewed** cards. A record moves to the top of the card
the moment **you open it**, whether or not you edit it. It is the fastest way back to
whatever you were just working on — no searching, no hunting.

## How it works

- Opening a record's detail page records the visit for you.
- Opening it again moves it back to the top.
- The card shows your most recently opened records of that object, newest first.
- Click any row to jump straight back to that record.

## It's private to you

Your recently viewed list is **yours alone** — each person sees only the records they
personally opened, and only records they still have access to. Renamed records show
their current name automatically.

## Building your own

In the Home Page builder, add a **Recently Viewed** component and pick which object it
tracks (Opportunities, Properties, Work Orders, and so on). It needs no saved list
view — it reads your personal view history directly.
$md$,
 'Navigation', 'internal', true,
 (SELECT ha_created_by FROM public.help_articles WHERE ha_created_by IS NOT NULL ORDER BY ha_created_at DESC LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.help_articles WHERE ha_record_number = 'HA-00167');

NOTIFY pgrst, 'reload schema';
