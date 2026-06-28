-- ─── Time-based reminder dispatcher ────────────────────────────────────
-- pg_cron-driven worker that scans upcoming service appointments and
-- fires reminder_48hr, reminder_24hr, and reminder_morning_of at the
-- right times via the same fire-notification orchestrator the AFTER-
-- INSERT/UPDATE triggers use.
--
-- Two classes of reminder:
--   • Offset-based (NT-00003 -2880, NT-00004 -1440): the template's
--     nt_send_offset_minutes is non-NULL. Fire when
--     now() ∈ [sa_start + offset - LOOKBEHIND, sa_start + offset + LOOKAHEAD].
--   • Morning-of (NT-00005, offset NULL): fire when the SA's start_time
--     falls on today's Chicago calendar day AND it's currently between
--     07:55 and 08:05 America/Chicago.
--
-- Idempotency: skip any (sa, template) pair that already has a
-- notification_logs row in status queued/sent/delivered. Cron runs
-- every 5 minutes; the ±5-minute window guarantees coverage even with
-- one missed tick, and the idempotency check prevents double-sends if
-- a tick runs twice.
--
-- All status types are eligible EXCEPT Completed, Canceled, No-Show,
-- Cannot Complete — reminders for an already-finished or already-
-- canceled SA would be confusing customer-facing noise.

create or replace function public.dispatch_due_reminders()
returns table (
  fired_sa_id      uuid,
  fired_template_id uuid,
  fired_trigger_event text
)
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_lookbehind_min int := 5;
  v_lookahead_min  int := 5;
  v_now            timestamptz := now();
  v_chicago_now    timestamp;
  v_chicago_today  date;
  v_terminal_status_ids uuid[];
begin
  select array_agg(id) into v_terminal_status_ids
  from picklist_values
  where picklist_object='service_appointments'
    and picklist_field='sa_status'
    and picklist_value in ('Completed', 'Canceled', 'No-Show', 'Cannot Complete');

  for fired_sa_id, fired_template_id, fired_trigger_event in
    with due_pairs as (
      select sa.id as sa_id,
             tpl.id as tpl_id,
             tpl.nt_trigger_event,
             tpl.nt_channel
      from service_appointments sa
      cross join notification_templates tpl
      where tpl.nt_is_deleted = false
        and tpl.nt_is_active = true
        and tpl.nt_send_offset_minutes is not null
        and (tpl.work_type_id is null or tpl.work_type_id = sa.work_type_id)
        and sa.sa_is_deleted = false
        and sa.contact_id is not null
        and (v_terminal_status_ids is null or not (sa.sa_status = any(v_terminal_status_ids)))
        and v_now >= sa.sa_scheduled_start_time + (tpl.nt_send_offset_minutes * interval '1 minute') - (v_lookbehind_min * interval '1 minute')
        and v_now <  sa.sa_scheduled_start_time + (tpl.nt_send_offset_minutes * interval '1 minute') + (v_lookahead_min  * interval '1 minute')
    ),
    not_already_logged as (
      select dp.* from due_pairs dp
      where not exists (
        select 1 from notification_logs nl
        where nl.service_appointment_id = dp.sa_id
          and nl.notification_template_id = dp.tpl_id
          and nl.nl_status in ('queued', 'sent', 'delivered')
      )
    )
    select sa_id, tpl_id, nt_trigger_event from not_already_logged
  loop
    perform public.enqueue_notification(fired_sa_id, fired_trigger_event, null);
    return next;
  end loop;

  v_chicago_now   := (v_now at time zone 'America/Chicago')::timestamp;
  v_chicago_today := v_chicago_now::date;

  if extract(hour from v_chicago_now) = 7  and extract(minute from v_chicago_now) >= 55
     or extract(hour from v_chicago_now) = 8 and extract(minute from v_chicago_now) <  5
  then
    for fired_sa_id, fired_template_id, fired_trigger_event in
      with morning_pairs as (
        select sa.id as sa_id,
               tpl.id as tpl_id,
               tpl.nt_trigger_event
        from service_appointments sa
        cross join notification_templates tpl
        where tpl.nt_is_deleted = false
          and tpl.nt_is_active = true
          and tpl.nt_trigger_event = 'reminder_morning_of'
          and tpl.nt_send_offset_minutes is null
          and (tpl.work_type_id is null or tpl.work_type_id = sa.work_type_id)
          and sa.sa_is_deleted = false
          and sa.contact_id is not null
          and (v_terminal_status_ids is null or not (sa.sa_status = any(v_terminal_status_ids)))
          and (sa.sa_scheduled_start_time at time zone 'America/Chicago')::date = v_chicago_today
      ),
      not_already_logged as (
        select mp.* from morning_pairs mp
        where not exists (
          select 1 from notification_logs nl
          where nl.service_appointment_id = mp.sa_id
            and nl.notification_template_id = mp.tpl_id
            and nl.nl_status in ('queued', 'sent', 'delivered')
        )
      )
      select sa_id, tpl_id, nt_trigger_event from not_already_logged
    loop
      perform public.enqueue_notification(fired_sa_id, fired_trigger_event, null);
      return next;
    end loop;
  end if;

  return;
end;
$$;

grant execute on function public.dispatch_due_reminders() to service_role;

select cron.schedule(
  'dispatch_due_reminders',
  '*/5 * * * *',
  $cron$ select public.dispatch_due_reminders(); $cron$
);
