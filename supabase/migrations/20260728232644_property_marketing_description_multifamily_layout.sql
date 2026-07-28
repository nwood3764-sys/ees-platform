-- Surface property_marketing_description on the Multifamily property record page.
-- Adds a dedicated "Property Marketing Description" section (Details tab) with a single
-- full-width textarea field bound to the new property_marketing_description column, placed
-- immediately after "Property Information". All 42 Lutheran Social Services properties that
-- received descriptions use the MULTIFAMILY record type, whose default layout is this one.
-- Additive: existing sections keep their relative order (shifted +1), no widgets removed.

DO $$
DECLARE
  v_layout  uuid := '947206ec-f831-4ce6-bebb-8eb1d6cc638f';  -- properties / Multifamily (default)
  v_section uuid;
BEGIN
  -- Guard: only run if the field is not already placed on this layout.
  IF EXISTS (
    SELECT 1 FROM public.page_layout_widgets w
    WHERE w.page_layout_id = v_layout
      AND coalesce(w.is_deleted,false) = false
      AND w.widget_config #>> '{fields}' LIKE '%property_marketing_description%'
  ) THEN
    RAISE NOTICE 'property_marketing_description already placed on layout %, skipping', v_layout;
    RETURN;
  END IF;

  -- Make room after "Property Information" (section_order 1).
  UPDATE public.page_layout_sections
     SET section_order = section_order + 1, updated_at = now()
   WHERE page_layout_id = v_layout
     AND section_order >= 2
     AND coalesce(is_deleted,false) = false;

  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES
    (gen_random_uuid(), v_layout, 2, 'Property Marketing Description', 1,
     false, false, 'Details', 'main')
  RETURNING id INTO v_section;

  INSERT INTO public.page_layout_widgets
    (id, page_layout_widget_record_number, page_layout_id, section_id, widget_type, widget_title,
     widget_column, widget_position, widget_size, widget_config,
     widget_is_user_customizable, widget_is_required)
  VALUES
    (gen_random_uuid(), '', v_layout, v_section, 'field_group', 'Property Marketing Description',
     1, 1, 'full',
     '{"fields":[{"name":"property_marketing_description","type":"textarea","label":"Marketing Description","column":1}]}'::jsonb,
     true, false);
END $$;
