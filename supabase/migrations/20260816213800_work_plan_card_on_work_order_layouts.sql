-- The work plan, on the work order record page.
--
-- Standing rule (Nicholas, 2026-08-16): "they should never leave the main app."
-- Following a work plan — steps in order, required photos and video,
-- measurement fields, N/A with a reason, submit for verification — lived only in
-- LEAP Pad at /field. Back-office staff uploading evidence for a work order had
-- to switch to the technician app to do it.
--
-- This adds a "Work Plan" tab to every work order page layout, holding a single
-- `work_plan` widget. The renderer mounts the SAME component LEAP Pad runs
-- (src/fieldMobile/WorkOrderDetail) in embedded mode, so both surfaces share one
-- implementation of the evidence gates — a desktop-only copy would drift from
-- the field one the first time a rule changed.
--
-- Its own tab rather than the Details tab: a plan can run to 20+ steps with
-- photo strips, which would bury the work order's own fields.
--
-- No schema change. `work_plan` needs no entry in a widget-type whitelist
-- (page_layout_widgets has no CHECK on widget_type) and
-- validate_page_layout_widget_config only inspects field_group and related_list
-- configs, so this widget passes validation untouched. Idempotent: re-running
-- adds nothing where the tab already exists.
DO $$
DECLARE
  lay        record;
  v_section  uuid;
  v_order    integer;
BEGIN
  FOR lay IN
    SELECT pl.id, pl.page_layout_name
      FROM public.page_layouts pl
     WHERE pl.page_layout_object = 'work_orders'
       AND pl.page_layout_type = 'record_detail'
       AND pl.is_deleted = false
  LOOP
    -- Already has a work plan card? Leave it alone.
    IF EXISTS (
      SELECT 1
        FROM public.page_layout_widgets w
        JOIN public.page_layout_sections s ON s.id = w.section_id
       WHERE s.page_layout_id = lay.id
         AND w.widget_type = 'work_plan'
         AND w.is_deleted = false AND s.is_deleted = false
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(s.section_order), 0) + 1 INTO v_order
      FROM public.page_layout_sections s
     WHERE s.page_layout_id = lay.id AND s.is_deleted = false;

    INSERT INTO public.page_layout_sections (
      page_layout_id, section_label, section_order, section_tab, section_placement, is_deleted
    ) VALUES (
      lay.id, 'Work Plan', v_order, 'Work Plan', 'main', false
    ) RETURNING id INTO v_section;

    -- '' for the record number: trg_page_layout_widget_record_number fills it
    -- (the standard LEAP auto-number pattern).
    INSERT INTO public.page_layout_widgets (
      page_layout_widget_record_number, page_layout_id, section_id, widget_type,
      widget_title, widget_position, widget_size, widget_config, is_deleted
    ) VALUES (
      '', lay.id, v_section, 'work_plan',
      'Work Plan', 0, 'full', jsonb_build_object('title', 'Work Plan'), false
    );
  END LOOP;
END $$;
