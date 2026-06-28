-- Automation executor dispatcher + action handlers.
--
-- Pipeline:
--   change_record_status (or future caller)
--     → execute_automation_rules(object, record_id, event, status_label)
--         → _automation_action_send_email / _create_task / _update_record
--             → notification_logs / tasks / projects
--         → automation_run_log row written per rule
--
-- Each action handler returns (outcome, message, created_id) as OUT params.
-- The dispatcher wraps each handler call in an EXCEPTION block so one bad
-- rule can't blow up an entire status change.
--
-- Supported action_types (v1):
--   send_email     — logs to notification_logs as 'queued'/'pending'.
--                     Microsoft Graph send happens later when wired.
--   create_task    — creates a real task in the tasks table, owner resolved
--                     from action_config.assigned_role.
--   update_record  — only handles the exact (parent_project +
--                     all_work_orders_verified) shape today; everything
--                     else marked 'skipped' with an explanatory message.
--                     Direct UPDATE on projects (bypasses
--                     change_record_status) to avoid recursive trigger
--                     loops if the project itself has automations.
-- All other action_types are skipped with an "not implemented yet" message.

-- ─── Helper: resolve a role name to a user id ────────────────────────────
-- Picks the first user with the matching role by stable id order. Returns
-- NULL if no user has the role.

CREATE OR REPLACE FUNCTION public._automation_resolve_role_user(p_role_name text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
   WHERE r.role_name = p_role_name
   ORDER BY u.id
   LIMIT 1;
$$;

-- ─── Action: send_email ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._automation_action_send_email(
  p_rule public.automation_rules,
  p_record_id uuid,
  OUT v_outcome text, OUT v_message text, OUT v_created_id uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_template_name text;
  v_recipient_role text;
  v_recipient_user uuid;
BEGIN
  v_template_name := p_rule.action_config ->> 'template';
  v_recipient_role := p_rule.action_config ->> 'recipient_role';
  v_recipient_user := _automation_resolve_role_user(v_recipient_role);
  IF v_recipient_user IS NULL THEN
    v_outcome := 'skipped';
    v_message := format('No user with role "%s"', v_recipient_role);
    v_created_id := NULL;
    RETURN;
  END IF;
  INSERT INTO public.notification_logs
    (nl_record_number, nl_trigger_event, nl_channel, nl_subject, nl_status, nl_provider)
  VALUES
    ('', 'automation_rule', 'email',
     format('Automation: %s', v_template_name),
     'queued', 'pending')
  RETURNING id INTO v_created_id;
  v_outcome := 'success';
  v_message := format('Queued email "%s" to role %s (user %s)',
    v_template_name, v_recipient_role, v_recipient_user);
END; $$;

-- ─── Action: create_task ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._automation_action_create_task(
  p_rule public.automation_rules,
  p_record_id uuid,
  OUT v_outcome text, OUT v_message text, OUT v_created_id uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task_name text;
  v_assigned_role text;
  v_assigned_user uuid;
  v_due_days integer;
BEGIN
  v_task_name := p_rule.action_config ->> 'task_name';
  v_assigned_role := p_rule.action_config ->> 'assigned_role';
  v_due_days := COALESCE((p_rule.action_config ->> 'due_days')::integer, 1);
  v_assigned_user := _automation_resolve_role_user(v_assigned_role);
  IF v_assigned_user IS NULL THEN
    v_outcome := 'skipped';
    v_message := format('No user with role "%s"', v_assigned_role);
    v_created_id := NULL;
    RETURN;
  END IF;
  INSERT INTO public.tasks
    (subject, description, status, priority, due_date,
     owner_id, related_object, related_id,
     is_automated, automation_rule)
  VALUES
    (v_task_name,
     format('Auto-created by rule: %s', p_rule.name),
     'Open', 'Normal',
     (now() + (v_due_days || ' days')::interval)::date,
     v_assigned_user,
     p_rule.trigger_object, p_record_id,
     true, p_rule.name)
  RETURNING id INTO v_created_id;
  v_outcome := 'success';
  v_message := format('Created task "%s" assigned to %s (due in %s days)',
    v_task_name, v_assigned_role, v_due_days);
END; $$;

-- ─── Action: update_record ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._automation_action_update_record(
  p_rule public.automation_rules,
  p_record_id uuid,
  OUT v_outcome text, OUT v_message text, OUT v_created_id uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target text;
  v_condition text;
  v_new_status text;
  v_project_id uuid;
  v_all_verified boolean;
  v_new_status_id uuid;
  v_current_status_id uuid;
BEGIN
  v_target := p_rule.action_config ->> 'target';
  v_condition := p_rule.action_config ->> 'condition';
  v_new_status := p_rule.action_config ->> 'new_status';
  v_created_id := NULL;

  IF v_target = 'parent_project' AND v_condition = 'all_work_orders_verified' THEN
    SELECT project_id INTO v_project_id
      FROM public.work_orders WHERE id = p_record_id;
    IF v_project_id IS NULL THEN
      v_outcome := 'skipped';
      v_message := 'Work order has no parent project';
      RETURN;
    END IF;
    SELECT NOT EXISTS (
      SELECT 1 FROM public.work_orders w
        LEFT JOIN public.picklist_values pv ON pv.id = w.work_order_status
       WHERE w.project_id = v_project_id
         AND NOT w.work_order_is_deleted
         AND COALESCE(pv.picklist_value, '') NOT LIKE '%Verified%'
    ) INTO v_all_verified;
    IF NOT v_all_verified THEN
      v_outcome := 'skipped';
      v_message := 'Not all work orders on this project are verified yet';
      RETURN;
    END IF;
    SELECT id INTO v_new_status_id
      FROM public.picklist_values
     WHERE picklist_object = 'projects' AND picklist_field = 'project_status'
       AND picklist_value = v_new_status
       AND picklist_is_active
     LIMIT 1;
    IF v_new_status_id IS NULL THEN
      v_outcome := 'error';
      v_message := format('No active project_status picklist value "%s"', v_new_status);
      RETURN;
    END IF;
    SELECT project_status INTO v_current_status_id
      FROM public.projects WHERE id = v_project_id;
    IF v_current_status_id = v_new_status_id THEN
      v_outcome := 'skipped';
      v_message := format('Project already at "%s"', v_new_status);
      RETURN;
    END IF;
    UPDATE public.projects SET
      project_status     = v_new_status_id,
      project_updated_at = now()
    WHERE id = v_project_id;
    v_created_id := v_project_id;
    v_outcome := 'success';
    v_message := format('Set parent project to "%s"', v_new_status);
  ELSE
    v_outcome := 'skipped';
    v_message := format('Unsupported update_record config: target=%s condition=%s',
      v_target, v_condition);
  END IF;
END; $$;

-- ─── Main dispatcher ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.execute_automation_rules(
  p_object text,
  p_record_id uuid,
  p_event text,
  p_status_label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.automation_rules%ROWTYPE;
  v_outcome text;
  v_message text;
  v_created_id uuid;
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = auth.uid();

  FOR v_rule IN
    SELECT *
      FROM public.automation_rules
     WHERE is_active = true
       AND trigger_object = p_object
       AND trigger_event = p_event
       AND (
         (p_event = 'status_change' AND p_status_label IS NOT NULL
            AND trigger_status = p_status_label)
         OR p_event <> 'status_change'
       )
     ORDER BY execution_order ASC NULLS LAST, created_at ASC
  LOOP
    BEGIN
      IF v_rule.action_type = 'send_email' THEN
        SELECT * INTO v_outcome, v_message, v_created_id
          FROM _automation_action_send_email(v_rule, p_record_id);
      ELSIF v_rule.action_type = 'create_task' THEN
        SELECT * INTO v_outcome, v_message, v_created_id
          FROM _automation_action_create_task(v_rule, p_record_id);
      ELSIF v_rule.action_type = 'update_record' THEN
        SELECT * INTO v_outcome, v_message, v_created_id
          FROM _automation_action_update_record(v_rule, p_record_id);
      ELSE
        v_outcome := 'skipped';
        v_message := format('Action type "%s" not implemented yet', v_rule.action_type);
        v_created_id := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_outcome := 'error';
      v_message := format('%s: %s', SQLSTATE, SQLERRM);
      v_created_id := NULL;
    END;

    INSERT INTO public.automation_run_log
      (arl_record_number, arl_rule_id, arl_rule_name,
       arl_trigger_object, arl_trigger_record_id, arl_trigger_event, arl_trigger_status,
       arl_action_type, arl_outcome, arl_outcome_message, arl_created_target_id, arl_fired_by)
    VALUES
      ('', v_rule.id, v_rule.name,
       p_object, p_record_id, p_event, p_status_label,
       v_rule.action_type, v_outcome, v_message, v_created_id, v_user_id);
  END LOOP;
END;
$$;
