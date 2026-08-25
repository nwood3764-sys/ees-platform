-- List views can say OR.
--
-- Nicholas, 2026-08-25: "I need to be able to say, and when I have filters, not
-- a combination. I need to have properties owned by Lutheran and properties
-- managed by Lutheran."
--
-- A saved list view stored its filters and nothing about how they combine,
-- because there was only one answer: every filter must match. That intersection
-- answers neither half of the question above — a company that both owns and
-- manages the same property is a different, much smaller set than the two the
-- user asked to see. Filter logic (the Salesforce "1 AND (2 OR 3)" expression,
-- already built and validated for the report builder in
-- src/lib/reportFilters.js) is now part of a list view's definition, so a view
-- saved with OR still means OR when it is reopened.
--
-- Its own column, deliberately, rather than another key inside the
-- list_view_filters jsonb: how filters combine is a distinct fact from what
-- they are, and it is a value the platform will want to read directly.
--
-- NULL / 'all' both mean match every filter, which is what every view saved
-- before this migration means. Nothing is backfilled and no existing view
-- changes behavior.

ALTER TABLE public.saved_list_views
  ADD COLUMN IF NOT EXISTS list_view_filter_logic text;

COMMENT ON COLUMN public.saved_list_views.list_view_filter_logic IS
  'How this view''s filters combine: a Salesforce-style filter-logic expression over the filters'' 1-based numbers, e.g. "1 AND (2 OR 3)". NULL or ''all'' means every filter must match (the default, and the meaning of every view saved before filter logic existed). Parsed and validated by src/lib/reportFilters.js parseFilterLogic().';

-- The expression is evaluated client-side against numbered filters, so the
-- constraint here is only that it is a sane, bounded string — the grammar is
-- validated (with the user-facing error messages) before it is ever saved.
ALTER TABLE public.saved_list_views
  DROP CONSTRAINT IF EXISTS saved_list_views_filter_logic_check;
ALTER TABLE public.saved_list_views
  ADD CONSTRAINT saved_list_views_filter_logic_check
  CHECK (
    list_view_filter_logic IS NULL
    OR (
      length(list_view_filter_logic) BETWEEN 1 AND 500
      AND list_view_filter_logic ~ '^[0-9()[:space:]]*(?:(?:AND|OR|NOT|all)[0-9()[:space:]]*)*$'
    )
  );
