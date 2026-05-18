-- Communications Module v1, Slice 1
-- Patches clone_email_template to propagate the three locked-region columns:
--   template_locked_regions, template_ai_assist_allowed, template_default_outbound_mailbox_id
--
-- Prior version omitted them from the INSERT column list, so a clone would land
-- with locked_regions=[] (default), ai_assist_allowed=true (default), and
-- default_outbound_mailbox_id=NULL — silently losing the locked structure that
-- defines the template's authoring contract.
--
-- Snapshots are unaffected: publish_email_template uses to_jsonb(row) which
-- already captures all columns including the new ones.

CREATE OR REPLACE FUNCTION public.clone_email_template(
  p_source_email_template_id uuid,
  p_new_name text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_caller   uuid := public.current_app_user_id();
  v_src      public.email_templates%ROWTYPE;
  v_new_id   uuid;
  v_draft    uuid;
  v_name     text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'clone_email_template: must be authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_src FROM public.email_templates
  WHERE id = p_source_email_template_id AND NOT is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clone_email_template: source % not found or deleted', p_source_email_template_id;
  END IF;

  SELECT id INTO v_draft FROM public.picklist_values
  WHERE picklist_object='email_templates' AND picklist_field='status'
    AND picklist_value='Draft' AND picklist_is_active=true LIMIT 1;
  IF v_draft IS NULL THEN
    v_draft := v_src.status;
  END IF;

  v_name := COALESCE(p_new_name, v_src.name || ' (Clone)');

  INSERT INTO public.email_templates (
    et_record_number, name, description, subject, body_html,
    program_id, state, related_object, record_type,
    trigger_status, is_manual, is_automated,
    status, owner_id, created_by, updated_by, version,
    template_locked_regions,
    template_ai_assist_allowed,
    template_default_outbound_mailbox_id
  ) VALUES (
    '', v_name, v_src.description, v_src.subject, v_src.body_html,
    v_src.program_id, v_src.state, v_src.related_object, v_src.record_type,
    v_src.trigger_status, v_src.is_manual, v_src.is_automated,
    v_draft, v_caller, v_caller, v_caller, 1,
    v_src.template_locked_regions,
    v_src.template_ai_assist_allowed,
    v_src.template_default_outbound_mailbox_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;
