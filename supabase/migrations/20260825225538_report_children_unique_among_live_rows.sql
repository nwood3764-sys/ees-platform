-- ============================================================================
-- A report's filters and groupings are unique among LIVE rows, not among
-- every row that ever existed
-- ----------------------------------------------------------------------------
-- Nicholas, 2026-08-25: "I like to clone our report and then modify it. I hit
-- Save As, and it gave me a big error about duplicate."
--
-- Root cause, and it is not about cloning. `save_report_children` replaces a
-- report's filters and groupings the way everything in LEAP replaces rows: it
-- SOFT-deletes the current set and inserts the new set, numbered from 1. But
-- the uniqueness of (report, filter index) was declared as a plain UNIQUE
-- constraint, which counts soft-deleted rows — so the moment a report with a
-- filter was saved a second time, the re-inserted filter 1 collided with the
-- soft-deleted filter 1 and the whole save failed with
--
--   duplicate key value violates unique constraint
--   "report_filters_rfilt_report_id_rfilt_filter_index_key"
--
-- Save As hits it first because its first step is a save of the source. Plain
-- Save on any report carrying a filter or a grouping fails the same way.
--
-- In a platform where nothing is ever hard-deleted, "unique" means unique
-- among the rows that are still there. Both constraints become partial unique
-- indexes on the live rows. This only ever ALLOWS rows a plain unique
-- constraint rejected — a live duplicate is still refused — so no existing
-- data is invalidated and nothing that saves today stops saving.
--
-- Verified against prod in a rolled-back transaction beforehand: re-saving
-- RPT-00021's own three filters raised 23505 on the constraint above.
--
-- NOTE, found while fixing this and deliberately NOT changed here (it belongs
-- to the e-signature subsystem, not to reports): envelope_recipients carries
-- the same shape — `envelope_recipients_unique_order` UNIQUE (envelope_id,
-- recipient_order) with no live-row predicate. Any path that replaces an
-- envelope's recipients will fail the same way.
-- ============================================================================

alter table public.report_filters
  drop constraint if exists report_filters_rfilt_report_id_rfilt_filter_index_key;

create unique index if not exists report_filters_live_filter_index_key
  on public.report_filters (rfilt_report_id, rfilt_filter_index)
  where is_deleted = false;

alter table public.report_groupings
  drop constraint if exists report_groupings_rgr_report_id_rgr_grouping_level_key;

create unique index if not exists report_groupings_live_grouping_level_key
  on public.report_groupings (rgr_report_id, rgr_grouping_level)
  where is_deleted = false;

-- The rule must actually hold: a live duplicate is still refused.
do $verify$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select rfilt_report_id, rfilt_filter_index
      from public.report_filters where is_deleted = false
     group by 1, 2 having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'report_filters has % live duplicate (report, index) pairs', v_dupes;
  end if;

  select count(*) into v_dupes from (
    select rgr_report_id, rgr_grouping_level
      from public.report_groupings where is_deleted = false
     group by 1, 2 having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'report_groupings has % live duplicate (report, level) pairs', v_dupes;
  end if;
end
$verify$;
