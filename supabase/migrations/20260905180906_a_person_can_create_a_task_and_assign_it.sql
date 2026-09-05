-- =============================================================================
-- A person can create a task and assign it
--
-- Nicholas, 2026-09-05: "the tasks are something separate, like someone creates
-- a task, just like Salesforce. I just don't see that anywhere in the database.
-- Maybe I'm missing it, but we need that, right?"
--
-- The table is there and he is still right. All 71 live tasks were written by a
-- database trigger — every one on a work order, every one still 'Open', not one
-- ever completed — because there has never been a way for a person to make one.
-- This migration is the database half of fixing that.
--
-- Four things, and the first is the one that unlocks the rest.
--
-- 1. tasks numbers its records `task_number`, where every other record-carrying
--    table on the platform uses `<prefix>_record_number`. That is not cosmetic:
--    the platform DERIVES facts from that column rather than keeping a list.
--    `recordInsertDefaults` finds a table's column prefix by it, and
--    `conversation_related_to_objects()` uses it as the test for "is this a
--    record-carrying table" — which is why, after the polymorphic Related To
--    work landed today and made Communications available on 72 objects, tasks
--    was not one of them. Tasks was excluded by a naming accident dating to the
--    baseline, not by a decision. Renaming it to `task_record_number` makes
--    tasks a first-class record everywhere at once.
--
-- 2. Task statuses and priorities were free text with three competing
--    vocabularies: the column default said 'Task Open', every writer passed
--    'Open', and the client filter offered Open / In Progress / Completed /
--    Cancelled hardcoded in TasksModule.jsx. There were ZERO picklist_values
--    rows for tasks, so an admin could not manage them at all.
--
--    The VALUES are seeded exactly as they are written today, so nothing
--    breaks: create_work_order_review_task, _create_field_data_review_task,
--    complete_work_order_review and _automation_action_create_task all keep
--    writing 'Open' and 'Completed' and keep working, untouched. What changes
--    is that the vocabulary now lives in the database and the LABELS read
--    `[Object] [State]` — "Task Open", "Task Completed" — which is the platform
--    naming rule as it applies to what a person reads. This is the same split
--    the incentive rename used: the label is for people, the value is the API
--    name, and changing only the label puts no working path at risk.
--
-- 3. `tasks` carries no block_hard_delete trigger, alone among entity tables,
--    so DELETE FROM tasks succeeds. LEAP is soft-deletes only. Verified first
--    that nothing in the database hard-deletes a task, so adding the guard
--    cannot break a working path.
--
-- 4. The task page layout was a raw field dump — it showed a person "Is Ai
--    Created", "Automation Rule" and "Reminder Sent", rendered Status and
--    Priority as free-text boxes, and rendered Related as a picklist over a
--    uuid. It is rebuilt so the create pop-up asks for the five facts that make
--    a task real and the record page shows the rest in a sane order.
--
-- Deliberately NOT done here, and each for a reason:
--   - `status` stays TEXT rather than becoming a uuid FK to picklist_values.
--     Converting it means patching four working database functions and every
--     client filter to chase a naming improvement, on the one path that is
--     currently working. The picklist rows land first; the column conversion
--     is its own change with its own proof.
--   - No record_type column. Tasks have never had one and nothing asks for one
--     yet; adding a type system before there are two kinds of task is
--     inventing configuration nobody has asked for.
-- =============================================================================

BEGIN;

-- ── 1. tasks numbers its records the way every other object does ────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tasks' AND column_name='task_number'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tasks' AND column_name='task_record_number'
  ) THEN
    ALTER TABLE public.tasks RENAME COLUMN task_number TO task_record_number;
  END IF;
END $$;

-- The generator writes the renamed column. Re-emitted rather than patched: the
-- whole body is three lines, so there is nothing to corrupt.
CREATE OR REPLACE FUNCTION public.generate_task_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.task_record_number IS NULL OR NEW.task_record_number = '' THEN
    NEW.task_record_number := 'TSK-' || lpad(nextval('task_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. The task vocabulary lives in the database ────────────────────────────
-- Values are what the platform already writes; labels are what a person reads.
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order, picklist_is_active)
VALUES
  ('tasks','status','Open',        'Task Open',        10, true),
  ('tasks','status','In Progress', 'Task In Progress', 20, true),
  ('tasks','status','Completed',   'Task Completed',   30, true),
  ('tasks','status','Cancelled',   'Task Cancelled',   40, true),
  ('tasks','priority','Critical',  'Critical',         10, true),
  ('tasks','priority','High',      'High',             20, true),
  ('tasks','priority','Normal',    'Normal',           30, true),
  ('tasks','priority','Low',       'Low',              40, true)
ON CONFLICT DO NOTHING;

-- The column default said 'Task Open', which matches no value any writer uses
-- and no option the UI offers, so a row inserted on the default landed outside
-- every filter. It now agrees with the seeded vocabulary.
ALTER TABLE public.tasks ALTER COLUMN status SET DEFAULT 'Open';

-- ── 3. A task is soft-deleted like every other record ───────────────────────
DROP TRIGGER IF EXISTS trg_block_hard_delete_tasks ON public.tasks;
CREATE TRIGGER trg_block_hard_delete_tasks
  BEFORE DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- ── 4. The task page layout stops being a field dump ────────────────────────
DO $$
DECLARE
  v_layout uuid;
  v_sec    uuid;
BEGIN
  SELECT id INTO v_layout
  FROM public.page_layouts
  WHERE page_layout_object='tasks' AND coalesce(is_deleted,false)=false
  ORDER BY page_layout_record_number
  LIMIT 1;

  IF v_layout IS NULL THEN
    RAISE EXCEPTION 'No tasks page layout found — expected PL-00137';
  END IF;

  -- The record's own detail group. Ordered the way a person reads a task:
  -- what it is, who owns it, when it is due, where it came from.
  SELECT s.id INTO v_sec
  FROM public.page_layout_sections s
  WHERE s.page_layout_id=v_layout AND coalesce(s.is_deleted,false)=false
    AND s.section_label='Record'
  LIMIT 1;

  IF v_sec IS NOT NULL THEN
    UPDATE public.page_layout_widgets w
       SET widget_config = jsonb_build_object('fields', jsonb_build_array(
             jsonb_build_object('name','task_record_number','type','text','label','Task Number','system_audit',true),
             jsonb_build_object('name','subject','type','text','label','Subject','required',true),
             jsonb_build_object('name','status','type','picklist','label','Status','required',true),
             jsonb_build_object('name','priority','type','picklist','label','Priority','required',true),
             jsonb_build_object('name','owner_id','type','lookup','label','Assigned To',
                                'lookup_table','users','lookup_field','user_name','required',true),
             jsonb_build_object('name','due_date','type','date','label','Due Date'),
             jsonb_build_object('name','description','type','textarea','label','Description'),
             jsonb_build_object('name','completed_date','type','date','label','Completed Date'),
             jsonb_build_object('name','reminder_date','type','datetime','label','Reminder Date'),
             jsonb_build_object('name','related_object','type','text','label','Related To Object','system_audit',true),
             jsonb_build_object('name','automation_rule','type','text','label','Created By Automation','system_audit',true)
           ))
     WHERE w.section_id=v_sec
       AND w.widget_type='field_group'
       AND coalesce(w.is_deleted,false)=false;
  END IF;
END $$;

-- ── Assertions ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  -- The rename landed and kept every record number.
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tasks' AND column_name='task_record_number';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tasks.task_record_number does not exist after the rename';
  END IF;

  SELECT count(*) INTO v_n FROM public.tasks WHERE task_record_number IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'the rename lost % task record numbers', v_n;
  END IF;

  -- THE POINT OF THE RENAME: tasks is now a record a thread can be related to.
  -- Before this migration conversation_related_to_objects() returned 72 objects
  -- and tasks was not among them, because it failed the %_record_number test.
  SELECT count(*) INTO v_n
  FROM public.conversation_related_to_objects() WHERE object_name='tasks';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'tasks is still not a Related To object (got % rows)', v_n;
  END IF;

  -- The vocabulary is in the database, and every status a live row carries is
  -- one of the seeded values. A seeded set that does not cover the live data
  -- would blank the status filter on real records.
  SELECT count(*) INTO v_n FROM public.picklist_values
   WHERE picklist_object='tasks' AND picklist_field='status' AND picklist_is_active;
  IF v_n <> 4 THEN RAISE EXCEPTION 'expected 4 task statuses, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.picklist_values
   WHERE picklist_object='tasks' AND picklist_field='priority' AND picklist_is_active;
  IF v_n <> 4 THEN RAISE EXCEPTION 'expected 4 task priorities, found %', v_n; END IF;

  SELECT count(*) INTO v_n
  FROM public.tasks t
  WHERE coalesce(t.is_deleted,false)=false
    AND NOT EXISTS (
      SELECT 1 FROM public.picklist_values p
      WHERE p.picklist_object='tasks' AND p.picklist_field='status'
        AND p.picklist_value = t.status);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% live tasks carry a status outside the seeded vocabulary', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.tasks t
  WHERE coalesce(t.is_deleted,false)=false
    AND NOT EXISTS (
      SELECT 1 FROM public.picklist_values p
      WHERE p.picklist_object='tasks' AND p.picklist_field='priority'
        AND p.picklist_value = t.priority);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% live tasks carry a priority outside the seeded vocabulary', v_n;
  END IF;

  -- Soft-delete guard is on.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid='public.tasks'::regclass AND tgname='trg_block_hard_delete_tasks'
     AND NOT tgisinternal;
  IF v_n <> 1 THEN RAISE EXCEPTION 'block_hard_delete is not installed on tasks'; END IF;
END $$;

COMMIT;
