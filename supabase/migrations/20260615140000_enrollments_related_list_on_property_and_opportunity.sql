-- Add an "Enrollments" related list to every property and opportunity layout
-- on the Related tab. Property uses fk property_id; opportunity uses
-- opportunity_id. Idempotent.
DO $$
DECLARE pl RECORD; v_sec uuid; v_fk text; v_maxpos integer;
BEGIN
  FOR pl IN SELECT id, page_layout_object FROM public.page_layouts
            WHERE page_layout_object IN ('properties','opportunities') AND is_deleted=false
  LOOP
    IF EXISTS (SELECT 1 FROM public.page_layout_widgets w
      WHERE w.page_layout_id=pl.id AND w.is_deleted=false AND w.widget_type='related_list'
        AND (w.widget_config->>'table')='enrollments') THEN CONTINUE; END IF;
    v_fk := CASE WHEN pl.page_layout_object='properties' THEN 'property_id' ELSE 'opportunity_id' END;
    SELECT id INTO v_sec FROM public.page_layout_sections
      WHERE page_layout_id=pl.id AND section_tab='Related' AND is_deleted=false ORDER BY section_order LIMIT 1;
    IF v_sec IS NULL THEN
      INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
      VALUES (pl.id, 200, 'Related Records', 1, 'Related', 'main') RETURNING id INTO v_sec;
    END IF;
    SELECT COALESCE(max(widget_position),0)+1 INTO v_maxpos FROM public.page_layout_widgets WHERE section_id=v_sec AND is_deleted=false;
    INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config)
    VALUES (pl.id, v_sec, 'related_list', 'Enrollments', 1, v_maxpos, 'full',
      jsonb_build_object('fk', v_fk, 'table','enrollments','title','Enrollments',
        'columns', jsonb_build_array(
          jsonb_build_object('name','enrollment_record_number','type','text','label','Record #'),
          jsonb_build_object('name','enrollment_name','type','text','label','Name'),
          jsonb_build_object('name','enrollment_record_type','type','picklist','label','Record Type'),
          jsonb_build_object('name','enrollment_status','type','picklist','label','Status'),
          jsonb_build_object('name','enrollment_qualifying_mode','type','text','label','Income Qual')),
        'sort_dir','desc','sort_field','enrollment_created_at','is_deleted_col','enrollment_is_deleted'));
  END LOOP;
END $$;
