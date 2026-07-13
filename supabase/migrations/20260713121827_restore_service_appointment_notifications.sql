-- =====================================================================
-- RESTORE the service appointment notification pipeline, verbatim from
-- the baseline schema. Migration 20260713121244 removed it under a
-- misread of scope: the instruction concerned the new insulation
-- removal WORK ORDER build, but the notification pipeline serves
-- ASSESSMENT SCHEDULING (booking confirmations, reminders, on-my-way /
-- arrived lifecycle texts), which must keep working.
--
-- Everything below is byte-identical to the baseline definitions:
-- functions, triggers, grants, the 5-minute reminder cron, and the
-- active flags on templates NT-00001..NT-00013.
--
-- Applied to production 2026-07-13 via MCP (version 20260713121827).
-- Verified post-apply: 2 SA triggers, cron active */5, 4 functions,
-- all 14 templates active; zero customer-attached appointments existed
-- during the ~10-minute outage, so no notification was missed.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.enqueue_notification(p_service_appointment_id uuid, p_trigger_event text, p_channel text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
declare
  v_url    text;
  v_body   jsonb;
begin
  -- Allow session-level opt-out for bulk operations.
  if coalesce(current_setting('app.suppress_notifications', true), '') = 'on' then
    return;
  end if;

  -- Hardcoded to this project's functions URL. Self-hosted forks would
  -- override the GUC; for the EES-WI environment this is stable.
  v_url := coalesce(
    nullif(current_setting('app.fire_notification_url', true), ''),
    'https://flyjigrijjjtcsvpgzvk.supabase.co/functions/v1/fire-notification'
  );

  v_body := jsonb_build_object(
    'service_appointment_id', p_service_appointment_id,
    'trigger_event',          p_trigger_event
  );
  if p_channel is not null then
    v_body := v_body || jsonb_build_object('channel', p_channel);
  end if;

  -- Fire-and-forget. net.http_post queues and returns a request_id; we
  -- don't await the response. pg_net stores the result in net._http_response
  -- for debugging if needed.
  perform net.http_post(
    url := v_url,
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sa_fire_booking_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Skip soft-deleted inserts (shouldn't happen normally; defensive).
  if NEW.sa_is_deleted then return null; end if;
  -- Skip when no customer is attached — synthetic seed SAs (bulk-schedule
  -- output, dispatcher-created internal-only SAs) won't have a contact
  -- to notify. The orchestrator would also no-op in this case, but
  -- short-circuiting at the trigger avoids an unnecessary HTTP call.
  if NEW.contact_id is null then return null; end if;

  perform public.enqueue_notification(NEW.id, 'booking_confirmation', null);
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sa_fire_status_or_reschedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old_status text;
  v_new_status text;
  v_event      text;
begin
  -- Don't fire on soft-delete; that's an admin action, not a lifecycle event.
  if NEW.sa_is_deleted then return null; end if;
  -- No customer = no notification (same logic as INSERT path).
  if NEW.contact_id is null then return null; end if;

  -- Status change? Look up labels for both sides; only fire when the
  -- new status is one of the mapped values.
  if NEW.sa_status is distinct from OLD.sa_status then
    select picklist_value into v_old_status from picklist_values where id = OLD.sa_status;
    select picklist_value into v_new_status from picklist_values where id = NEW.sa_status;

    v_event := case v_new_status
      when 'En Route'  then 'on_my_way'
      when 'Arrived'   then 'arrived'
      when 'Completed' then 'completed'
      when 'Canceled'  then 'canceled'
      else null
    end;

    if v_event is not null then
      perform public.enqueue_notification(NEW.id, v_event, null);
    end if;
    -- Status change always supersedes — don't also fire reschedule.
    return null;
  end if;

  -- No status change but the schedule time moved → reschedule.
  if NEW.sa_scheduled_start_time is distinct from OLD.sa_scheduled_start_time then
    perform public.enqueue_notification(NEW.id, 'rescheduled', null);
  end if;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_due_reminders()
 RETURNS TABLE(fired_sa_id uuid, fired_template_id uuid, fired_trigger_event text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
declare
  v_lookbehind_min int := 5;   -- cron runs every 5 min; cover one missed tick
  v_lookahead_min  int := 5;
  v_now            timestamptz := now();
  v_chicago_now    timestamp;
  v_chicago_today  date;
  v_terminal_status_ids uuid[];
begin
  -- Resolve terminal status picklist ids once. Reminders never fire for
  -- SAs in these states regardless of timing.
  select array_agg(id) into v_terminal_status_ids
  from picklist_values
  where picklist_object='service_appointments'
    and picklist_field='sa_status'
    and picklist_value in ('Completed', 'Canceled', 'No-Show', 'Cannot Complete');

  -- ─── Offset-based reminders (NT-00003 -2880, NT-00004 -1440) ──────
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
        -- Match on work_type when the template carries one; else NULL global
        and (tpl.work_type_id is null or tpl.work_type_id = sa.work_type_id)
        and sa.sa_is_deleted = false
        and sa.contact_id is not null
        and (v_terminal_status_ids is null or not (sa.sa_status = any(v_terminal_status_ids)))
        -- The reminder fires when now() lands inside the offset window.
        -- sa_start + offset_minutes_as_interval bracketed by lookbehind/ahead.
        and v_now >= sa.sa_scheduled_start_time + (tpl.nt_send_offset_minutes * interval '1 minute') - (v_lookbehind_min * interval '1 minute')
        and v_now <  sa.sa_scheduled_start_time + (tpl.nt_send_offset_minutes * interval '1 minute') + (v_lookahead_min  * interval '1 minute')
    ),
    -- Idempotency: exclude pairs already logged in any non-failed state.
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

  -- ─── Morning-of reminder (NT-00005, NULL offset) ──────────────────
  -- Fire only between 07:55 and 08:05 America/Chicago, only for SAs
  -- whose calendar day (Chicago) matches today.
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
$function$;

-- Triggers (verbatim) ----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sa_after_insert_booking_confirmation ON public.service_appointments;
DROP TRIGGER IF EXISTS trg_sa_after_update_lifecycle ON public.service_appointments;
CREATE TRIGGER trg_sa_after_insert_booking_confirmation AFTER INSERT ON public.service_appointments FOR EACH ROW EXECUTE FUNCTION trg_sa_fire_booking_confirmation();
CREATE TRIGGER trg_sa_after_update_lifecycle AFTER UPDATE ON public.service_appointments FOR EACH ROW EXECUTE FUNCTION trg_sa_fire_status_or_reschedule();

-- Grants (verbatim from baseline) -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.dispatch_due_reminders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_due_reminders() TO postgres;
GRANT EXECUTE ON FUNCTION public.dispatch_due_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(p_service_appointment_id uuid, p_trigger_event text, p_channel text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(p_service_appointment_id uuid, p_trigger_event text, p_channel text) TO postgres;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(p_service_appointment_id uuid, p_trigger_event text, p_channel text) TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sa_fire_booking_confirmation() TO postgres;
GRANT EXECUTE ON FUNCTION public.trg_sa_fire_booking_confirmation() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sa_fire_status_or_reschedule() TO postgres;
GRANT EXECUTE ON FUNCTION public.trg_sa_fire_status_or_reschedule() TO service_role;

-- Reminder cron (same name, schedule, and command as before) ---------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch_due_reminders') THEN
    PERFORM cron.schedule('dispatch_due_reminders', '*/5 * * * *', ' select public.dispatch_due_reminders(); ');
  END IF;
END $$;

-- Reactivate the notification templates ------------------------------------------
UPDATE public.notification_templates
   SET nt_is_active = true
 WHERE nt_is_deleted IS NOT TRUE
   AND nt_trigger_event IN (
     'booking_confirmation', 'reminder_48hr', 'reminder_24hr',
     'reminder_morning_of', 'on_my_way', 'arrived', 'completed',
     'canceled', 'rescheduled'
   );

NOTIFY pgrst, 'reload schema';
