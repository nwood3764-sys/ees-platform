-- A report remembers how wide its columns are.
--
-- Nicholas, 2026-08-29: "I need a way to adjust the column widths and never have
-- them change again. There's too much of this auto-scaling and moving around...
-- It shouldn't change unless the user changes the widths."
--
-- The report table was laid out `auto` (the browser default), which re-measures
-- every column from the widest cell in it — so re-running the report, changing a
-- filter, expanding a group or an inline edit re-laid out the whole table. The
-- viewer now lays it out FIXED and gives every column an explicit width, and
-- this is where a width someone set is kept.
--
-- On the REPORT, not per user: a report is a shared named artifact, so its
-- layout is part of it — the same rule that already governs its columns, its
-- filters and its format. (A saved LIST VIEW keeps its own widths in
-- saved_list_views.list_view_column_widths; a report is not a list view and does
-- not share that column.)
--
-- Shape: { "<column key>": <px> } where the key is the column's hop path plus
-- its name (`opportunity_id>opportunity_account_id>account_name`), or
-- `calc:<label>` for a calculated field — so the same column name reached
-- through two different relationships keeps two widths. NULL means nothing has
-- been sized, and every column falls back to a default derived from its type.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS rpt_column_widths jsonb;

COMMENT ON COLUMN public.reports.rpt_column_widths IS
  'Per-column pixel widths for this report''s table, keyed by hop path + column name (e.g. {"ia_status": 320, "opportunity_id>opportunity_name": 260, "calc:% of Total": 150}). NULL = none set; each column falls back to a width derived from its type. Written when a column edge is dragged in the report viewer.';
