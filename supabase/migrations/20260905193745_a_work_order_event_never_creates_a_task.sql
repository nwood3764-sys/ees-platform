-- ═══════════════════════════════════════════════════════════════════════════
-- A work order event never creates a task.
--
-- Nicholas, 2026-09-05: "I never once told you to create tasks for work
-- orders... When a work order is submitted, the project coordinator needs to
-- verify it, but that's an approval process, not a task."
--
-- He is right, and nothing in the history asked for this. Four functions wrote
-- a `tasks` row on a work-order event; between them they produced 71 tasks,
-- every one still Open, NOT ONE ever completed in two months. A to-do list
-- nobody works is not a signal, it is noise on a screen.
--
-- The tasks were never load-bearing. The verification review reads the WORK
-- ORDER'S OWN STATUS -- fetchReviewQueue selects work orders in To Be Verified
-- and Corrections Needed -- so removing the tasks removes nothing a reviewer
-- can see. What the tasks actually were is a substitute signal for a screen
-- that already existed and had simply never been used: 57 work orders sit in
-- To Be Verified and NOT ONE has ever carried an approval status.
--
-- Where an event genuinely has to reach a person, it now writes an IN-APP
-- NOTIFICATION -- the mechanism complete_work_order_review already used for
-- its own success path. No feature is removed; the vehicle changes.
--
-- This is the machine half of the same ruling the concurrent
-- `a_person_can_create_a_task_and_assign_it` migration fixes from the other
-- side: a task is something a PERSON creates and assigns, the way Salesforce
-- means it. Nothing automated writes one on a work order.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Submitted for verification: no task at all ───────────────────────────
-- The review queue IS the signal. A task here duplicated a status the work
-- order already carries, and a notification would duplicate the queue.
-- (The trigger also hardcoded the To Be Verified uuid, which breaks the
-- platform's no-hardcoding rule and would be wrong on any database whose
-- picklists were seeded separately.)
drop trigger if exists trg_work_orders_review_task on public.work_orders;
drop function if exists public.create_work_order_review_task();

-- ── 2. Field-created records: a notification, not a task ────────────────────
-- Three callers (create_assessment_work_order,
-- create_mf_building_assessment_work_order,
-- create_technician_work_order_for_property) are deliberately untouched --
-- the signature and the fallback behaviour are unchanged, only the row it
-- writes.
create or replace function public._create_field_data_review_task(
  p_work_order_id uuid, p_wo_rn text, p_property_name text, p_actor uuid, p_created_list text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_reviewer uuid := public._resolve_field_review_coordinator();
  v_fallback boolean := false;
begin
  if v_reviewer is null then
    v_reviewer := p_actor;
    v_fallback := true;
  end if;

  insert into public.notifications (recipient_id, notification_type, title, body,
                                    related_object, related_id, channel, is_automated, triggered_by)
  values (
    v_reviewer, 'field_created_data_review',
    format('Check field-created records — %s at %s', p_wo_rn, coalesce(p_property_name, 'property')),
    format('A technician created records in the field that need an accuracy review: %s. Verify the property, building, unit, and project are correct and consistent (naming conventions, right account, no duplicates). Open the work order: /work_orders/%s%s',
           p_created_list, p_work_order_id,
           case when v_fallback then ' — NOTE: no Project Coordinator is configured (no user holds the role and no acting coordinator is designated), so this went to the creating technician. Set one in LEAP Admin to route these reviews.' else '' end),
    'work_orders', p_work_order_id, 'in_app', true, p_actor
  );
end;
$fn$;

-- ── 3. Step completion notifies the coordinator: patched IN PLACE ───────────
-- Read the deployed definition, cut one anchored slice, and RAISE if the
-- anchor is missing or the slice is not the task insert. Retyping a working
-- trigger to change one statement is how one gets corrupted.
do $$
declare
  v_src  text;
  v_open int;
  v_end  int;
  v_slice text;
  v_new  text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_project_coordinator_on_step_completion';
  if v_src is null then
    raise exception 'notify_project_coordinator_on_step_completion not found';
  end if;

  v_open := position('INSERT INTO public.tasks' in v_src);
  if v_open = 0 then
    raise exception 'anchor not found: notify_project_coordinator_on_step_completion no longer inserts a task';
  end if;
  v_end := position(');' in substring(v_src from v_open));
  if v_end = 0 then
    raise exception 'could not find the end of the task insert';
  end if;
  v_slice := substring(v_src from v_open for v_end + 1);
  if position('work_step_completion_pc_notification' in v_slice) = 0 then
    raise exception 'the slice about to be replaced is not the task insert: %', left(v_slice, 200);
  end if;

  v_new := replace(v_src, v_slice,
    'INSERT INTO public.notifications (recipient_id, notification_type, title, body,' || E'\n' ||
    '                                  related_object, related_id, channel, is_automated, triggered_by)' || E'\n' ||
    '  VALUES (' || E'\n' ||
    '    v_reviewer, ''work_step_completed'',' || E'\n' ||
    '    format(''%s — %s on %s'', NEW.work_step_name, v_wo.work_order_record_number, COALESCE(v_wo.work_order_property_name, ''the property'')),' || E'\n' ||
    '    format(''Step "%s" was completed on %s (%s) — review the photos and comment, and follow up (e.g. reorder damaged materials). Open the work order: /work_orders/%s'',' || E'\n' ||
    '           NEW.work_step_name, v_wo.work_order_record_number, v_wo.work_order_name, v_wo.id),' || E'\n' ||
    '    ''work_orders'', v_wo.id, ''in_app'', true, COALESCE(NEW.work_step_updated_by, NEW.work_step_owner)' || E'\n' ||
    '  );');

  if v_new = v_src then
    raise exception 'patch made no change to notify_project_coordinator_on_step_completion';
  end if;
  execute v_new;
end $$;

-- ── 4. complete_work_order_review: patched IN PLACE ─────────────────────────
-- Two things go: the corrections-needed task (replaced by a notification to
-- the technician, who otherwise learns nothing) and the two UPDATEs that
-- completed tasks which will no longer exist.
do $$
declare
  v_src   text;
  v_open  int;
  v_end   int;
  v_slice text;
  v_new   text;
  v_cuts  int := 0;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_work_order_review';
  if v_src is null then raise exception 'complete_work_order_review not found'; end if;

  -- (a) the corrections-needed task insert -> a notification
  v_open := position('INSERT INTO public.tasks' in v_src);
  if v_open = 0 then
    raise exception 'anchor not found: complete_work_order_review no longer inserts a task';
  end if;
  v_end := position(');' in substring(v_src from v_open));
  if v_end = 0 then raise exception 'could not find the end of the corrections task insert'; end if;
  v_slice := substring(v_src from v_open for v_end + 1);
  if position('work_order_corrections_needed' in v_slice) = 0 then
    raise exception 'the slice about to be replaced is not the corrections task insert: %', left(v_slice, 200);
  end if;

  v_new := replace(v_src, v_slice,
    'INSERT INTO public.notifications (recipient_id, notification_type, title, body,' || E'\n' ||
    '                                  related_object, related_id, channel, is_automated, triggered_by)' || E'\n' ||
    '  VALUES (' || E'\n' ||
    '    v_wo.work_order_owner, ''work_order_corrections_needed'',' || E'\n' ||
    '    format(''Corrections needed — %s'', v_wo.work_order_record_number),' || E'\n' ||
    '    format(''The Project Coordinator sent %s back for corrections: %s%s Rework the flagged steps in LEAP Pad and resubmit for verification. Open the work order: /work_orders/%s'',' || E'\n' ||
    '           v_wo.work_order_record_number, trim(p_comment),' || E'\n' ||
    '           CASE WHEN v_rejected_list IS NOT NULL THEN E''\\n\\nSteps needing correction:\\n'' || v_rejected_list || E''\\n\\n'' ELSE '' '' END,' || E'\n' ||
    '           p_wo_id),' || E'\n' ||
    '    ''work_orders'', p_wo_id, ''in_app'', true, v_uid' || E'\n' ||
    '  );');
  if v_new = v_src then raise exception 'the corrections-task patch made no change'; end if;
  v_src := v_new;

  -- (b) both UPDATE statements that completed the now-defunct tasks
  loop
    v_open := position('UPDATE public.tasks SET status = ''Completed''' in v_src);
    exit when v_open = 0;
    v_end := position(';' in substring(v_src from v_open));
    if v_end = 0 then raise exception 'could not find the end of a task-completion UPDATE'; end if;
    v_src := overlay(v_src placing '' from v_open for v_end);
    v_cuts := v_cuts + 1;
  end loop;
  if v_cuts <> 2 then
    raise exception 'expected to remove 2 task-completion UPDATEs, removed %', v_cuts;
  end if;

  execute v_src;
end $$;

-- ── 5. Remove the 71 ────────────────────────────────────────────────────────
-- Nicholas: "remove all the old ones. They're not valuable." Soft-delete,
-- which is the platform's only deletion mode and keeps the rows recoverable.
-- Every one is machine-written, still Open, and never worked.
update public.tasks
   set is_deleted = true,
       deleted_at = now(),
       updated_at = now()
 where is_deleted is not true
   and related_object = 'work_orders';

-- ── 6. Assert it ────────────────────────────────────────────────────────────
do $$
declare
  v_live      int;
  v_writers   text;
  v_to_verify int;
begin
  select count(*) into v_live
    from public.tasks where is_deleted is not true and related_object = 'work_orders';
  if v_live <> 0 then
    raise exception '% work-order tasks are still live', v_live;
  end if;

  -- No function may write a task on a work-order path any more. The flow
  -- builder's own action (_automation_action_create_task) is deliberately
  -- exempt: a person configuring a flow that creates a task is ASKING for one.
  select string_agg(p.proname, ', ' order by p.proname) into v_writers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.prosrc ilike '%insert into public.tasks%' or p.prosrc ilike '%insert into tasks%')
     and p.proname not in ('_automation_action_create_task', 'complete_vehicle_inspection');
  if v_writers is not null then
    raise exception 'these functions still write a task: %', v_writers;
  end if;

  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'work_orders' and t.tgname = 'trg_work_orders_review_task') then
    raise exception 'trg_work_orders_review_task still exists';
  end if;

  -- CONTROL: the work orders themselves must not have moved. The review queue
  -- reads their status, and that is the whole point of this being safe.
  select count(*) into v_to_verify
    from public.work_orders wo
    join public.picklist_values pv on pv.id = wo.work_order_status
   where wo.work_order_is_deleted is not true and pv.picklist_value = 'To Be Verified';
  if v_to_verify < 1 then
    raise exception 'expected work orders still waiting in To Be Verified, found %', v_to_verify;
  end if;
  raise notice 'work-order tasks removed; % work orders still queued for review', v_to_verify;
end $$;
