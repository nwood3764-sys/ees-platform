-- WI-IRA-MF-HEAR opportunity page layout — mirror the WI-IRA-MF-HOMES one
--
-- Nicholas: "for the opportunity page layout, just copy over exactly what we
-- have for the HOMES for Multifamily Wisconsin."
--
-- The two layouts had drifted badly. PL-00342 (WI-IRA-MF-HOMES) carries the
-- opportunity's whole lifecycle -- Opportunity Information, Line Items,
-- Assessment, Income Qualification, Project Qualification / Planning / Approval /
-- Implementation, Accounting, System Information, plus the Related tab and the
-- right rail. PL-00341 (WI-IRA-MF-HEAR) carried a thin subset, so the same
-- opportunity looked like a different object depending on its program.
--
-- This replaces PL-00341's CONTENTS with a copy of PL-00342's. It does NOT
-- create a second layout and does not touch PL-00342: the HEAR layout record
-- already exists and is already bound to the WI-IRA-MF-HEAR record type, so the
-- artifact is right and only what it holds was wrong. Old sections/widgets are
-- soft-deleted (never hard-deleted) with a reason naming this change.
--
-- Scope note: this is the OPPORTUNITY layout only. The incentive application
-- (the Focus on Energy submittal form) and the enrollment are separate objects
-- with their own layouts and are deliberately untouched here.

DO $$
DECLARE
  v_homes uuid;
  v_hear  uuid;
  v_sec   record;
  v_new   uuid;
  v_count integer;
BEGIN
  SELECT l.id INTO v_homes
  FROM page_layouts l
  JOIN picklist_values rt ON rt.id = l.record_type_id
  WHERE l.page_layout_object = 'opportunities'
    AND rt.picklist_object = 'opportunities' AND rt.picklist_field = 'record_type'
    AND rt.picklist_value = 'WI-IRA-MF-HOMES'
    AND l.is_deleted IS NOT TRUE;

  SELECT l.id INTO v_hear
  FROM page_layouts l
  JOIN picklist_values rt ON rt.id = l.record_type_id
  WHERE l.page_layout_object = 'opportunities'
    AND rt.picklist_object = 'opportunities' AND rt.picklist_field = 'record_type'
    AND rt.picklist_value = 'WI-IRA-MF-HEAR'
    AND l.is_deleted IS NOT TRUE;

  IF v_homes IS NULL THEN
    RAISE EXCEPTION 'WI-IRA-MF-HOMES opportunity layout not found';
  END IF;
  IF v_hear IS NULL THEN
    RAISE EXCEPTION 'WI-IRA-MF-HEAR opportunity layout not found';
  END IF;

  -- Retire the old HEAR contents. Widgets first: a section carrying live widgets
  -- would leave them orphaned on a NOT NULL section_id.
  UPDATE page_layout_widgets
     SET is_deleted = true
   WHERE page_layout_id = v_hear AND is_deleted IS NOT TRUE;

  UPDATE page_layout_sections
     SET is_deleted = true,
         deletion_reason = 'Replaced by a copy of the WI-IRA-MF-HOMES opportunity layout'
   WHERE page_layout_id = v_hear AND is_deleted IS NOT TRUE;

  -- Copy section by section so each new section id can carry its own widgets.
  FOR v_sec IN
    SELECT * FROM page_layout_sections
     WHERE page_layout_id = v_homes AND is_deleted IS NOT TRUE
     ORDER BY section_order
  LOOP
    INSERT INTO page_layout_sections (
      page_layout_id, section_order, section_label, section_columns,
      section_is_collapsible, section_is_collapsed_by_default,
      section_tab, section_placement, is_deleted
    )
    VALUES (
      v_hear, v_sec.section_order, v_sec.section_label, v_sec.section_columns,
      v_sec.section_is_collapsible, v_sec.section_is_collapsed_by_default,
      v_sec.section_tab, v_sec.section_placement, false
    )
    RETURNING id INTO v_new;

    INSERT INTO page_layout_widgets (
      page_layout_widget_record_number, page_layout_id, section_id,
      widget_type, widget_title, widget_column, widget_position, widget_size,
      widget_config, widget_is_user_customizable, widget_is_required, is_deleted
    )
    SELECT
      '',                                  -- trigger fills the record number
      v_hear, v_new,
      w.widget_type, w.widget_title, w.widget_column, w.widget_position, w.widget_size,
      w.widget_config, w.widget_is_user_customizable, w.widget_is_required, false
    FROM page_layout_widgets w
    WHERE w.section_id = v_sec.id AND w.is_deleted IS NOT TRUE
    ORDER BY w.widget_position;
  END LOOP;

  -- Prove the copy is faithful rather than assuming the loop ran.
  SELECT count(*) INTO v_count
  FROM page_layout_sections WHERE page_layout_id = v_hear AND is_deleted IS NOT TRUE;
  IF v_count <> (SELECT count(*) FROM page_layout_sections
                  WHERE page_layout_id = v_homes AND is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'Section count mismatch after copying the HOMES opportunity layout';
  END IF;

  SELECT count(*) INTO v_count
  FROM page_layout_widgets WHERE page_layout_id = v_hear AND is_deleted IS NOT TRUE;
  IF v_count <> (SELECT count(*) FROM page_layout_widgets
                  WHERE page_layout_id = v_homes AND is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'Widget count mismatch after copying the HOMES opportunity layout';
  END IF;

  -- The Line Items card is the reason the price book work is reachable at all;
  -- assert it survived the copy.
  IF NOT EXISTS (
    SELECT 1 FROM page_layout_widgets
    WHERE page_layout_id = v_hear AND is_deleted IS NOT TRUE
      AND widget_config->>'table' = 'opportunity_line_items'
  ) THEN
    RAISE EXCEPTION 'Copied HEAR opportunity layout has no opportunity_line_items card';
  END IF;
END $$;
