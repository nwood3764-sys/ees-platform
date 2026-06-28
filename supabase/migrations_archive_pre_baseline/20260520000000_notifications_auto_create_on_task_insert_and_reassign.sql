-- Auto-create an in-app notification when a task is assigned to someone.
-- Fires on INSERT (new task) and on UPDATE OF owner_id (reassignment).
-- Skip when owner_id IS NULL or owner_id = created_by_id (self-assignment
-- shouldn't ping you about your own action).
--
-- The notifications row carries the source object/id so the bell-icon
-- click-through can navigate to the originating record (e.g. the work
-- order this task was created on, not the task itself — but we default
-- to the task itself if related_object is null).

CREATE OR REPLACE FUNCTION public.trg_task_create_notification() RETURNS trigger AS $$
DECLARE
  v_creator_user uuid;
  v_owner_user   uuid;
  v_title        text;
  v_body         text;
  v_rel_object   text;
  v_rel_id       uuid;
BEGIN
  v_owner_user := NEW.owner_id;
  v_creator_user := NEW.created_by_id;

  IF v_owner_user IS NULL THEN RETURN NEW; END IF;
  IF v_owner_user = v_creator_user THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.owner_id IS NOT DISTINCT FROM NEW.owner_id THEN
    RETURN NEW;
  END IF;

  IF NEW.is_automated THEN
    v_title := 'Task assigned by automation: ' || coalesce(NEW.subject, 'Untitled task');
  ELSE
    v_title := 'New task assigned: ' || coalesce(NEW.subject, 'Untitled task');
  END IF;
  v_body := coalesce(NEW.description, '');
  IF NEW.due_date IS NOT NULL THEN
    v_body := trim(both E'\n' from v_body || E'\nDue: ' || to_char(NEW.due_date, 'YYYY-MM-DD'));
  END IF;

  IF NEW.related_object IS NOT NULL AND NEW.related_id IS NOT NULL THEN
    v_rel_object := NEW.related_object;
    v_rel_id     := NEW.related_id;
  ELSE
    v_rel_object := 'tasks';
    v_rel_id     := NEW.id;
  END IF;

  INSERT INTO notifications (
    recipient_id, notification_type, title, body,
    related_object, related_id, channel,
    is_read, is_sent, triggered_by, is_automated, is_seed_data
  ) VALUES (
    v_owner_user,
    CASE WHEN TG_OP = 'INSERT' THEN 'task_assigned' ELSE 'task_reassigned' END,
    v_title, NULLIF(v_body, ''),
    v_rel_object, v_rel_id,
    'in_app',
    false, true, v_creator_user, NEW.is_automated, false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tasks_create_notification_iu ON public.tasks;
CREATE TRIGGER tasks_create_notification_iu
  AFTER INSERT OR UPDATE OF owner_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_task_create_notification();
