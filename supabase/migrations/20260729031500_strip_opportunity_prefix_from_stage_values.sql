-- Full "Opportunity — " prefix removal from opportunity_stage STORED VALUES.
--
-- Follows the label cleanup (20260729030447). The em-dash object prefix is
-- import cruft, not the naming standard. Safe because:
--   * Opportunity records reference the stage by UUID
--     (opportunities.opportunity_stage → picklist_values.id) — no record touched.
--   * stage_document_requirements references by UUID (sdr_stage_value_id) — the
--     paperwork/submittal pipeline is unaffected.
--   * The (picklist_object, picklist_field, picklist_value) UNIQUE constraint
--     stays satisfied — verified 0 collisions after stripping.
--   * No report_filters / automation_rules / validation_rules store the string.
-- The only string consumers are three RPCs that resolve a stage by its value;
-- they are rewritten here in the same transaction so they keep resolving.

-- 1. Strip the prefix from the 182 opportunity_stage value strings.
UPDATE public.picklist_values
   SET picklist_value = regexp_replace(picklist_value, '^Opportunity\s*—\s*', '')
 WHERE picklist_object = 'opportunities'
   AND picklist_field  = 'opportunity_stage'
   AND picklist_value LIKE 'Opportunity — %';

-- 2. Rewrite the three functions that look a stage up by its value string,
--    replacing the now-renamed literal. pg_get_functiondef round-trips the whole
--    definition, so each body stays byte-identical except the single stage
--    literal; CREATE OR REPLACE preserves existing privileges. Each function
--    contains exactly one "Opportunity — " occurrence (the stage lookup).
DO $rw$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('create_assessment_work_order',
                        'create_homes_intake',
                        'create_technician_work_order_for_property')
  LOOP
    EXECUTE replace(pg_get_functiondef(r.oid), 'Opportunity — ', '');
  END LOOP;
END $rw$;

NOTIFY pgrst, 'reload schema';
