-- Add Work Orders + Service Appointments related lists to every Project page layout.
-- These were missing entirely — Projects only surfaced Documents + Envelopes as
-- related lists, hiding the actual operational data. Both are inserted before
-- Documents (section_order=100) and Envelopes (section_order=200).

DO $$
DECLARE
  v_layout record;
  v_wo_section_id uuid;
  v_sa_section_id uuid;
BEGIN
  FOR v_layout IN
    SELECT id FROM page_layouts
     WHERE page_layout_object='projects' AND is_deleted=false
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM page_layout_sections
       WHERE page_layout_id=v_layout.id AND section_label='Work Orders' AND is_deleted=false
    ) THEN
      INSERT INTO page_layout_sections (
        page_layout_id, section_order, section_label,
        section_columns, section_is_collapsible, section_is_collapsed_by_default,
        section_tab, is_deleted
      ) VALUES (
        v_layout.id, 50, 'Work Orders',
        1, true, false, 'Related', false
      )
      RETURNING id INTO v_wo_section_id;

      INSERT INTO page_layout_widgets (
        page_layout_widget_record_number, page_layout_id, section_id,
        widget_type, widget_title, widget_column, widget_position, widget_size,
        widget_config, widget_is_user_customizable, widget_is_required, is_deleted
      ) VALUES (
        '', v_layout.id, v_wo_section_id,
        'related_list', 'Work Orders', 1, 1, 'full',
        jsonb_build_object(
          'fk', 'project_id',
          'table', 'work_orders',
          'columns', jsonb_build_array(
            jsonb_build_object('name','work_order_record_number','type','text','label','WO #'),
            jsonb_build_object('name','work_order_name','type','text','label','Name'),
            jsonb_build_object('name','work_order_status','type','picklist','label','Status'),
            jsonb_build_object('name','work_order_scheduled_start_date','type','date','label','Scheduled'),
            jsonb_build_object('name','work_order_created_at','type','datetime','label','Created')
          ),
          'sort_dir', 'asc',
          'sort_field', 'work_order_record_number',
          'is_deleted_col', 'work_order_is_deleted'
        ),
        true, false, false
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM page_layout_sections
       WHERE page_layout_id=v_layout.id AND section_label='Service Appointments' AND is_deleted=false
    ) THEN
      INSERT INTO page_layout_sections (
        page_layout_id, section_order, section_label,
        section_columns, section_is_collapsible, section_is_collapsed_by_default,
        section_tab, is_deleted
      ) VALUES (
        v_layout.id, 75, 'Service Appointments',
        1, true, false, 'Related', false
      )
      RETURNING id INTO v_sa_section_id;

      INSERT INTO page_layout_widgets (
        page_layout_widget_record_number, page_layout_id, section_id,
        widget_type, widget_title, widget_column, widget_position, widget_size,
        widget_config, widget_is_user_customizable, widget_is_required, is_deleted
      ) VALUES (
        '', v_layout.id, v_sa_section_id,
        'related_list', 'Service Appointments', 1, 1, 'full',
        jsonb_build_object(
          'fk', 'project_id',
          'table', 'service_appointments',
          'columns', jsonb_build_array(
            jsonb_build_object('name','sa_record_number','type','text','label','SA #'),
            jsonb_build_object('name','sa_name','type','text','label','Name'),
            jsonb_build_object('name','sa_status','type','picklist','label','Status'),
            jsonb_build_object('name','sa_scheduled_start_time','type','datetime','label','Scheduled Start'),
            jsonb_build_object('name','sa_scheduled_end_time','type','datetime','label','Scheduled End')
          ),
          'sort_dir', 'asc',
          'sort_field', 'sa_scheduled_start_time',
          'is_deleted_col', 'sa_is_deleted'
        ),
        true, false, false
      );
    END IF;
  END LOOP;
END $$;
