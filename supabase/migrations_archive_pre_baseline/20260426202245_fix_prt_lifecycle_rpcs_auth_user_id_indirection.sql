-- Same indirection fix as clone_project_report_template, applied to the
-- publish/unpublish/archive/restore RPCs. All four were stamping auth.uid()
-- into prt_updated_by, which references public.users.id and would fail with
-- a FK violation the moment any real user clicked Publish/Unpublish/Archive/
-- Restore in the UI.

CREATE OR REPLACE FUNCTION public.publish_project_report_template(p_prt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_caller uuid := public.current_app_user_id();
  v_current text;
  v_published_at timestamptz;
  v_version int;
  v_active_id uuid;
  v_section_count int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'publish: must be authenticated as a registered user' USING ERRCODE = '42501';
  END IF;

  SELECT _prt_status_value(prt_status), prt_published_at, prt_version
    INTO v_current, v_published_at, v_version
  FROM project_report_templates
  WHERE id = p_prt_id AND NOT prt_is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publish: template not found';
  END IF;

  IF v_current = 'Active' THEN
    RAISE EXCEPTION 'publish: template is already Active';
  END IF;
  IF v_current = 'Archived' THEN
    RAISE EXCEPTION 'publish: cannot publish an Archived template — restore to Draft first';
  END IF;

  SELECT id INTO v_active_id
  FROM picklist_values
  WHERE picklist_object='project_report_templates'
    AND picklist_field='prt_status'
    AND picklist_value='Active'
    AND picklist_is_active=true
  LIMIT 1;
  IF v_active_id IS NULL THEN
    RAISE EXCEPTION 'publish: Active status not configured';
  END IF;

  SELECT COUNT(*) INTO v_section_count
  FROM project_report_template_sections
  WHERE prt_id = p_prt_id AND NOT prts_is_deleted;
  IF v_section_count = 0 THEN
    RAISE EXCEPTION 'publish: template has no sections — add at least one before publishing';
  END IF;

  IF v_published_at IS NOT NULL THEN
    v_version := v_version + 1;
  END IF;

  UPDATE project_report_templates SET
    prt_status = v_active_id,
    prt_version = v_version,
    prt_published_at = COALESCE(prt_published_at, now()),
    prt_updated_by = v_caller,
    prt_updated_at = now()
  WHERE id = p_prt_id;

  RETURN jsonb_build_object(
    'ok', true,
    'prt_id', p_prt_id,
    'new_status', 'Active',
    'new_version', v_version,
    'first_publish', v_published_at IS NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.unpublish_project_report_template(p_prt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_caller uuid := public.current_app_user_id();
  v_current text;
  v_draft_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unpublish: must be authenticated as a registered user' USING ERRCODE = '42501';
  END IF;

  SELECT _prt_status_value(prt_status) INTO v_current
  FROM project_report_templates
  WHERE id = p_prt_id AND NOT prt_is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unpublish: template not found';
  END IF;
  IF v_current IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'unpublish: template is not Active (status: %)', v_current;
  END IF;

  SELECT id INTO v_draft_id
  FROM picklist_values
  WHERE picklist_object='project_report_templates'
    AND picklist_field='prt_status'
    AND picklist_value='Draft'
    AND picklist_is_active=true
  LIMIT 1;
  IF v_draft_id IS NULL THEN
    RAISE EXCEPTION 'unpublish: Draft status not configured';
  END IF;

  UPDATE project_report_templates SET
    prt_status = v_draft_id,
    prt_updated_by = v_caller,
    prt_updated_at = now()
  WHERE id = p_prt_id;

  RETURN jsonb_build_object('ok', true, 'prt_id', p_prt_id, 'new_status', 'Draft');
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_project_report_template(p_prt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_caller uuid := public.current_app_user_id();
  v_current text;
  v_archived_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'archive: must be authenticated as a registered user' USING ERRCODE = '42501';
  END IF;

  SELECT _prt_status_value(prt_status) INTO v_current
  FROM project_report_templates
  WHERE id = p_prt_id AND NOT prt_is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'archive: template not found';
  END IF;
  IF v_current = 'Archived' THEN
    RAISE EXCEPTION 'archive: template is already Archived';
  END IF;

  SELECT id INTO v_archived_id
  FROM picklist_values
  WHERE picklist_object='project_report_templates'
    AND picklist_field='prt_status'
    AND picklist_value='Archived'
    AND picklist_is_active=true
  LIMIT 1;
  IF v_archived_id IS NULL THEN
    RAISE EXCEPTION 'archive: Archived status not configured';
  END IF;

  UPDATE project_report_templates SET
    prt_status = v_archived_id,
    prt_is_default_for_unmapped = false,
    prt_updated_by = v_caller,
    prt_updated_at = now()
  WHERE id = p_prt_id;

  RETURN jsonb_build_object('ok', true, 'prt_id', p_prt_id, 'new_status', 'Archived');
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_project_report_template(p_prt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_caller uuid := public.current_app_user_id();
  v_current text;
  v_draft_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'restore: must be authenticated as a registered user' USING ERRCODE = '42501';
  END IF;

  SELECT _prt_status_value(prt_status) INTO v_current
  FROM project_report_templates
  WHERE id = p_prt_id AND NOT prt_is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore: template not found';
  END IF;
  IF v_current IS DISTINCT FROM 'Archived' THEN
    RAISE EXCEPTION 'restore: only Archived templates can be restored (current: %)', v_current;
  END IF;

  SELECT id INTO v_draft_id
  FROM picklist_values
  WHERE picklist_object='project_report_templates'
    AND picklist_field='prt_status'
    AND picklist_value='Draft'
    AND picklist_is_active=true
  LIMIT 1;
  IF v_draft_id IS NULL THEN
    RAISE EXCEPTION 'restore: Draft status not configured';
  END IF;

  UPDATE project_report_templates SET
    prt_status = v_draft_id,
    prt_updated_by = v_caller,
    prt_updated_at = now()
  WHERE id = p_prt_id;

  RETURN jsonb_build_object('ok', true, 'prt_id', p_prt_id, 'new_status', 'Draft');
END;
$function$;
