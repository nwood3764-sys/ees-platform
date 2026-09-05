-- The Manual J card, on every assessment layout, and the proof it landed.

DO $$
DECLARE
  v_layout   record;
  v_section  uuid;
  v_order    int;
  v_placed   int := 0;
BEGIN
  FOR v_layout IN
    SELECT id, page_layout_name FROM public.page_layouts
    WHERE page_layout_object = 'assessments' AND is_deleted IS NOT TRUE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.page_layout_widgets w
      JOIN public.page_layout_sections s ON s.id = w.section_id
      WHERE s.page_layout_id = v_layout.id AND w.widget_type = 'manual_j' AND w.is_deleted IS NOT TRUE
    ) THEN CONTINUE; END IF;

    SELECT id INTO v_section FROM public.page_layout_sections
    WHERE page_layout_id = v_layout.id AND is_deleted IS NOT TRUE
      AND section_label ILIKE '%Manual J%'
    LIMIT 1;

    IF v_section IS NULL THEN
      SELECT COALESCE(max(section_order), 0) + 1 INTO v_order
      FROM public.page_layout_sections WHERE page_layout_id = v_layout.id AND is_deleted IS NOT TRUE;

      INSERT INTO public.page_layout_sections
        (page_layout_id, section_label, section_order, section_columns, section_is_collapsible, section_is_collapsed_by_default, section_tab)
      VALUES (v_layout.id, 'Manual J Load Calculation', v_order, 1, true, false, 'Related')
      RETURNING id INTO v_section;
    END IF;

    -- page_layout_id is carried on the widget itself, and
    -- validate_page_layout_widget_config reads it to resolve the layout's
    -- object: a widget inserted without it validates against nothing.
    INSERT INTO public.page_layout_widgets
      (page_layout_id, section_id, widget_type, widget_title, widget_position, widget_column, widget_size, widget_config)
    VALUES (v_layout.id, v_section, 'manual_j', 'Manual J Load Calculation', 1, 1, 'full', '{}'::jsonb);
    v_placed := v_placed + 1;
  END LOOP;

  RAISE NOTICE 'Manual J card placed on % assessment layout(s)', v_placed;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Prove the shape rather than assert it in prose
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_n int; v_missing text;
BEGIN
  -- Every assessment layout carries the card, or this shipped a screen nobody
  -- can reach.
  SELECT count(*) INTO v_n
  FROM public.page_layouts pl
  WHERE pl.page_layout_object = 'assessments' AND pl.is_deleted IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.page_layout_widgets w
      JOIN public.page_layout_sections s ON s.id = w.section_id
      WHERE s.page_layout_id = pl.id AND w.widget_type = 'manual_j' AND w.is_deleted IS NOT TRUE);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% assessment layout(s) did not receive the Manual J card', v_n;
  END IF;

  -- The four objects are registered for state scoping. The engine fails
  -- closed, so an unregistered one is invisible rather than merely unscoped.
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['manual_j_reports','manual_j_load_blocks','manual_j_load_components','manual_j_building_materials']) t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.record_state_scope_sources s
    WHERE s.rsss_object_name = t AND s.rsss_is_active AND s.rsss_is_deleted IS NOT TRUE);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'not registered for state scoping: %', v_missing;
  END IF;

  -- Audit stamping reached all four.
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['manual_j_reports','manual_j_load_blocks','manual_j_load_components','manual_j_building_materials']) t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relname = t AND NOT tg.tgisinternal AND tg.tgname LIKE '%audit%');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'no audit stamping trigger on: %', v_missing;
  END IF;

  -- The name is composed by the database, so the create pop-up must not ask
  -- for it (the 2026-09-05 rule that a trigger-filled column is not demanded).
  IF NOT EXISTS (
    SELECT 1 FROM public.trigger_written_columns('manual_j_reports') t
    WHERE t.column_name = 'mjr_name') THEN
    RAISE EXCEPTION 'mjr_name is not reported as trigger-written; the create form will demand a derived name';
  END IF;
END $$;
