-- Fix: clone_project_report_template was stamping auth.uid() into FK columns
-- that reference public.users.id — would FK-violate the moment a real user
-- hit "Clone Template" because public.users.id ≠ auth.users.id (linked via
-- public.users.auth_user_id). Translate via current_app_user_id() to match
-- the rest of the codebase.
CREATE OR REPLACE FUNCTION public.clone_project_report_template(p_source_prt_id uuid, p_new_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_caller uuid := public.current_app_user_id();  -- public.users.id, not auth.uid()
  v_src project_report_templates%ROWTYPE;
  v_new_id uuid;
  v_status_draft uuid;
  v_clone_name text;
  v_section project_report_template_sections%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'clone_project_report_template: must be authenticated as a registered user';
  END IF;

  SELECT * INTO v_src
  FROM project_report_templates
  WHERE id = p_source_prt_id AND NOT prt_is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clone_project_report_template: source % not found or deleted', p_source_prt_id;
  END IF;

  -- Resolve Draft status uuid (fall back to original source status if Draft is missing)
  SELECT id INTO v_status_draft
  FROM picklist_values
  WHERE picklist_object='project_report_templates'
    AND picklist_field='prt_status'
    AND picklist_value='Draft'
    AND picklist_is_active=true
  LIMIT 1;
  IF v_status_draft IS NULL THEN
    v_status_draft := v_src.prt_status;
  END IF;

  v_clone_name := COALESCE(p_new_name, v_src.prt_name || ' (Clone)');

  -- Insert the new PRT (record_number auto-set by trg_prt_rn)
  INSERT INTO project_report_templates (
    prt_record_number, prt_name, prt_description,
    prt_record_type, prt_status, prt_orientation, prt_paper_size,
    prt_version, prt_is_default_for_unmapped,
    prt_owner, prt_created_by, prt_updated_by
  )
  VALUES (
    '', v_clone_name, v_src.prt_description,
    v_src.prt_record_type, v_status_draft, v_src.prt_orientation, v_src.prt_paper_size,
    1, false,
    v_caller, v_caller, v_caller
  )
  RETURNING id INTO v_new_id;

  -- Copy each non-deleted section
  FOR v_section IN
    SELECT * FROM project_report_template_sections
    WHERE prt_id = p_source_prt_id AND NOT prts_is_deleted
    ORDER BY prts_section_order ASC
  LOOP
    INSERT INTO project_report_template_sections (
      prts_record_number, prt_id, prts_section_order, prts_section_type,
      prts_section_title, prts_body_template, prts_config, prts_filter_config,
      prts_show_if_empty, prts_page_break_after,
      prts_created_by, prts_updated_by
    ) VALUES (
      '', v_new_id, v_section.prts_section_order, v_section.prts_section_type,
      v_section.prts_section_title, v_section.prts_body_template,
      COALESCE(v_section.prts_config, '{}'::jsonb),
      COALESCE(v_section.prts_filter_config, '{}'::jsonb),
      v_section.prts_show_if_empty, v_section.prts_page_break_after,
      v_caller, v_caller
    );
  END LOOP;

  RETURN v_new_id;
END;
$function$;
