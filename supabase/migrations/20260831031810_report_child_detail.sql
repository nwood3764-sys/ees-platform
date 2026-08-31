-- One row PER CHILD — Salesforce's "A with B" report type.
--
-- Nicholas, 2026-08-31, on reporting across relationships: "I can't have any
-- limitations here."
--
-- A roll-up (report_child_rollup, shipped alongside this) answers "how many
-- units does this building have" without changing what a row is. This answers
-- the other half: "list every unit, with its building's fields beside it" —
-- which DOES change what a row is, and so is a deliberate, declared choice on
-- the report rather than a side effect of picking a field.
--
--   {"child_table":"units","child_fk":"building_id","join":"inner","label":"Units"}
--
-- `join` is the toggle Salesforce puts on the report type:
--   inner — only primary records that HAVE children (the default; "Buildings
--           with Units" means with).
--   outer — every primary record, children or not, with the child columns blank
--           on the ones without. This is how you find the buildings that have
--           no units, which is usually the more interesting question.
--
-- NULL means an ordinary report: one row per primary record, exactly as before.
-- Every existing report has NULL, so nothing changes for any of them.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS rpt_child_detail jsonb;

COMMENT ON COLUMN public.reports.rpt_child_detail IS
  'Salesforce "A with B": when set, the report returns one row PER CHILD rather than one per primary record, with the primary record''s fields repeated. Shape: {"child_table":"units","child_fk":"building_id","join":"inner"|"outer","label":"Units"}. join=inner drops primary records that have no children; outer keeps them with the child columns blank. NULL = an ordinary report, one row per primary record. Child columns are selected as rpt_selected_fields entries with kind="child_field".';
