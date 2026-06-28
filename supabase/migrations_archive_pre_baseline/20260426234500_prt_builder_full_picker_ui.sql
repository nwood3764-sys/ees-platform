-- Report Builder UI completion. Three coordinated page-layout edits:
--
-- 1. PRTS Section Information widget — change prts_body_template field type
--    from plain 'textarea' to 'merge_textarea'. The new field type renders
--    the same textarea plus an Insert Merge Field picker that drops {{path}}
--    tokens at the cursor position. No data migration required (column type
--    is unchanged, just the editor surface).
--
-- 2. PRTS Filter Configuration widget — replace the raw JSON 'field_group'
--    widget with the new 'filter_config_editor' widget. The new widget reads
--    a per-section-type filter schema and renders a structured picker
--    (multi-select of picklist values per filter rule). For section types
--    with no filter schema (cover_page, project_summary, page_break, footer,
--    custom_text), the editor explains there are no filter rules instead of
--    showing an empty form. Strip "(Advanced)" from the section label since
--    the field is no longer raw JSON.
--
-- 3. PRT Versions section — add a new page_layout_section + page_layout_widget
--    of type 'prtsn_history'. The widget enumerates rows from
--    project_report_template_snapshots scoped to the current PRT and offers
--    a Preview-from-snapshot action per row. The widget is read-only;
--    snapshots are written by the publish RPC, never via this UI.

-- 1) PRTS body_template: textarea → merge_textarea
UPDATE page_layout_widgets
SET widget_config = jsonb_set(
  widget_config,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN f->>'name' = 'prts_body_template'
          THEN jsonb_set(f, '{type}', '"merge_textarea"', false)
        ELSE f
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(widget_config->'fields') WITH ORDINALITY AS x(f, ord)
  ),
  false
),
updated_at = now()
WHERE id = 'de6b8999-0373-4763-8184-fb5b2fadfa0a';

-- 2a) Replace the Filter Configuration field_group with filter_config_editor
UPDATE page_layout_widgets
SET widget_type = 'filter_config_editor',
    widget_title = 'Filter Configuration',
    widget_config = '{}'::jsonb,
    updated_at = now()
WHERE id = 'c15c63f7-1a47-46a8-b8a7-0e3dd0feeed1';

-- 2b) Rename the section: drop "(Advanced)" suffix
UPDATE page_layout_sections
SET section_label = 'Filter Configuration',
    updated_at = now()
WHERE id = '486d4adc-a6a0-4fc0-ab35-37af99c07eac';

-- 3) Versions section on the PRT page layout
DO $migration$
DECLARE
  v_section_id uuid;
BEGIN
  -- Add the Versions section. section_tab='Related' so the Versions list
  -- lives on the same tab as Sections + Record Type Assignments.
  INSERT INTO page_layout_sections (
    page_layout_id, section_label, section_order, section_tab,
    section_is_collapsible, section_is_collapsed_by_default
  ) VALUES (
    '028eb09d-161b-4acd-9888-2a638a3f8e1a', 'Versions', 4, 'Related',
    false, false
  ) RETURNING id INTO v_section_id;

  -- Add the prtsn_history widget inside it.
  INSERT INTO page_layout_widgets (
    section_id, page_layout_id, widget_type, widget_title,
    widget_column, widget_position, widget_size, widget_config
  ) VALUES (
    v_section_id, '028eb09d-161b-4acd-9888-2a638a3f8e1a',
    'prtsn_history', 'Versions',
    1, 1, 'full', '{}'::jsonb
  );
END;
$migration$;
