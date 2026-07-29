-- Strip the leftover "Opportunity — " prefix from opportunity_stage picklist
-- LABELS (display only).
--
-- This em-dash prefix is import cruft from the audit-template-builder — it is
-- NOT the platform status-naming standard (work_order_status has no object
-- prefix). An opportunity stage only ever appears in an opportunity context,
-- so repeating the object name on every value is redundant and distracting.
--
-- Scope is deliberately narrow and safe:
--   * Only opportunity_stage labels that actually start with "Opportunity — ".
--     Legitimate names that merely start with the word "Opportunity" (no
--     em-dash, e.g. "Opportunity Identified") are left untouched.
--   * project_status is NOT touched — its "Project …" names (e.g. "Project
--     Kickoff") are real names, not this prefix.
--   * picklist_value (the STORED value written on every opportunity record and
--     referenced by reports/automations/the stage lifecycle) is intentionally
--     left unchanged. Renaming stored values is a separate, heavier migration.
--
-- Reversible: re-prefixing the labels restores the prior state; no record data
-- is altered.

UPDATE public.picklist_values
   SET picklist_label = regexp_replace(picklist_label, '^Opportunity\s*—\s*', '')
 WHERE picklist_object = 'opportunities'
   AND picklist_field  = 'opportunity_stage'
   AND picklist_label ~ '^Opportunity\s*—\s*';
