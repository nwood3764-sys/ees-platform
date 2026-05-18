-- Append a "Conversion stats banner" section to HA-00037 covering the
-- KPI strip that lands on the queue surface above the sub-toolbar.
-- Three new anchors added for the concepts surfaced by the banner.
--
-- Companion to the migration-less frontend slice in the same commit:
--   src/data/dispatcherFollowups.js   — fetchDfrWeeklyStats() helper
--   src/components/dispatch/FollowupsQueue.jsx
--                                     — KpiStrip component + refreshStats
--                                       on conversion / resolved-or-closed flips

update help_articles
set ha_body_markdown = ha_body_markdown || E'\n\n### Conversion stats banner\n\nWhen at least one DFR has been captured in the last 7 days, a stats strip renders above the sub-toolbar with four tiles:\n\n- **Captured** — total DFRs captured in the trailing 7-day window. Includes everything regardless of current status. Neutral tone.\n- **Converted** — captured DFRs that resolved by producing a real Service Appointment (i.e. `dfr_resolved_sa_id IS NOT NULL`). Green tone. Subtitle shows the denominator (`of N resolved`) so the dispatcher can read the conversion ratio without doing math.\n- **Conversion** — converted ÷ resolved as a percentage. Color-coded by health: green ≥ 50%, amber 25–49%, red < 25%. Shows `—` (dash) with subtitle "no resolutions yet" when nothing has been resolved in the window.\n- **Still open** — captured DFRs whose status is still Open or In Progress (i.e. not yet resolved, not yet closed). Neutral tone.\n\nThe banner is hidden when zero DFRs have been captured in the window — fresh installations or quiet weeks don''t need a row of zeros taking up screen real estate. Returns once the first capture lands.\n\nThe banner refreshes automatically after any mutation that changes resolved or converted counts — Close, Schedule, or any direct record-detail status flip into Resolved/Closed (the refresh is fire-and-forget; a failure leaves the prior snapshot on screen). Open → In Progress claim flips stay inside the still-open bucket and don''t trigger a refresh.\n\nWhy these four numbers: they answer the only operational question the dispatcher has about the queue as a whole — "is this feature generating real value, or is it just a parking lot for leads?" Captured tells you the inbound volume. Converted ÷ Resolved tells you the success rate. Still Open tells you the unfinished work.\n\nData layer: `fetchDfrWeeklyStats()` in `src/data/dispatcherFollowups.js`. Single PostgREST query against `dispatcher_followup_requests` filtered to the trailing 7-day window, bucketed client-side. Server-side aggregation isn''t worth the round trip cost since the dispatcher viewport rarely exceeds a few dozen DFRs/week.',
ha_updated_at = now()
where ha_slug = 'dispatch-console-followups-queue' and not ha_is_deleted;

with t as (select id from help_articles where ha_slug='dispatch-console-followups-queue' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from t, (values
  ('concept'::text, null::text, null::text, null::text, 'conversion-stats-banner', 10),
  ('concept',       null,       null,       null,       'dfr-weekly-stats',       11),
  ('concept',       null,       null,       null,       'dfr-conversion-rate',    12)
) as t2(anchor_type, route, object, field, concept, sort_order);
