-- =============================================================================
-- Opportunity Stage Chevron
--
-- Nicholas (2026-07-27): the opportunity chevron must reflect each record
-- type's STAGES, not the Open/Won/Lost status. "We'll never use a status
-- chevron on anything."
--
-- The chevron widget (StatusPathWidget, widget_type 'status_path') and its
-- resolver RPC (picklist_values_for_record_type) already scope and order
-- picklist values per record type via picklist_value_record_type_assignments
-- (pvrta_sort_order) and honor picklist_show_in_path. The only thing wrong was
-- the binding: all six opportunity chevrons pointed at opportunity_status.
--
-- This migration:
--   1. Rebinds every opportunity status_path chevron to opportunity_stage.
--   2. Adds the chevron to the WI-IRA-MF-HOMES layout (the one flagship
--      opportunity layout that never had one).
--   3. Removes the 10 legacy generic opportunity_stage values that were never
--      scoped to any record type from the path. Because they have zero pvrta
--      assignments they are "universal" and would otherwise render on EVERY
--      record type's ladder. Hiding (not deleting) them keeps them selectable
--      and preserves the stored value on any record still pointing at one.
-- =============================================================================

-- 1. Rebind opportunity chevrons: opportunity_status -> opportunity_stage
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      COALESCE(w.widget_config, '{}'::jsonb),
      '{status_field}', '"opportunity_stage"'::jsonb, true),
    widget_title = 'Opportunity Stage Path'
FROM page_layouts pl
WHERE w.page_layout_id = pl.id
  AND pl.page_layout_object = 'opportunities'
  AND w.widget_type = 'status_path'
  AND w.is_deleted IS NOT TRUE
  AND COALESCE(w.widget_config->>'status_field', '') <> 'opportunity_stage';

-- 2. Add the stage chevron to the WI-IRA-MF-HOMES layout if it lacks one.
--    Record number left '' so trg_page_layout_widget_record_number fills it.
INSERT INTO page_layout_widgets
  (page_layout_widget_record_number, page_layout_id, section_id, widget_type,
   widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted)
SELECT '', pl.id, s.id, 'status_path', 'Opportunity Stage Path', 1, 0, 'full',
       '{"status_field":"opportunity_stage","show_guidance":true,"show_completed_count":true}'::jsonb,
       false
FROM page_layouts pl
JOIN page_layout_sections s
  ON s.page_layout_id = pl.id
 AND s.is_deleted IS NOT TRUE
 AND s.section_placement = 'main'
 AND s.section_tab = 'Details'
WHERE pl.page_layout_object = 'opportunities'
  AND pl.is_deleted IS NOT TRUE
  AND pl.record_type_id = (
        SELECT id FROM picklist_values
        WHERE picklist_object = 'opportunities'
          AND picklist_field = 'record_type'
          AND picklist_value = 'wi_ira_mf_homes')
  AND s.section_order = (
        SELECT min(s2.section_order) FROM page_layout_sections s2
        WHERE s2.page_layout_id = pl.id AND s2.is_deleted IS NOT TRUE
          AND s2.section_placement = 'main' AND s2.section_tab = 'Details')
  AND NOT EXISTS (
        SELECT 1 FROM page_layout_widgets w2
        WHERE w2.page_layout_id = pl.id
          AND w2.widget_type = 'status_path'
          AND w2.is_deleted IS NOT TRUE);

-- 3. Drop the legacy unscoped (universal) opportunity_stage values from the path
--    so they never pollute a record type's ladder. Kept active and selectable.
UPDATE picklist_values pv
SET picklist_show_in_path = false
WHERE pv.picklist_object = 'opportunities'
  AND pv.picklist_field = 'opportunity_stage'
  AND COALESCE(pv.picklist_show_in_path, true) = true
  AND NOT EXISTS (
        SELECT 1 FROM picklist_value_record_type_assignments a
        WHERE a.pvrta_picklist_value_id = pv.id
          AND a.pvrta_is_deleted = false);
