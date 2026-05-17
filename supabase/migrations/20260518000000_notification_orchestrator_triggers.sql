-- ─── Notification orchestrator triggers ───────────────────────────────
-- Hooks service_appointments lifecycle events into the fire-notification
-- edge function via pg_net (async, non-blocking).
--
-- Five trigger events are auto-fired:
--   booking_confirmation  — AFTER INSERT, when contact_id is populated
--   on_my_way             — sa_status → 'En Route'
--   arrived               — sa_status → 'Arrived'
--   completed             — sa_status → 'Completed'
--   canceled              — sa_status → 'Canceled'
--   rescheduled           — sa_scheduled_start_time changed without status change
--
-- Time-based reminders (reminder_48hr, reminder_24hr, reminder_morning_of)
-- and dispatcher_followup_required are NOT in this trigger — those need
-- pg_cron / dispatcher-action surfaces. Separate slice.
--
-- The escape hatch: when the session sets app.suppress_notifications='on',
-- triggers no-op. Useful for bulk inserts, data migrations, and
-- replay/repair operations where the customer shouldn't be re-notified.
--
-- Auth: fire-notification is verify_jwt=false (server-to-server), so the
-- trigger doesn't need to pass an auth header. The orchestrator validates
-- the SA exists + trigger_event is in the allowed set; the worst an
-- attacker with the function URL could do is fire valid notifications
-- they already knew the SA id for, which is auditable in messages /
-- notification_logs.

create or replace function public.enqueue_notification(
  p_service_appointment_id uuid,
  p_trigger_event          text,
  p_channel                text default null
)
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_url    text;
  v_body   jsonb;
begin
  if coalesce(current_setting('app.suppress_notifications', true), '') = 'on' then
    return;
  end if;

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

  perform net.http_post(
    url := v_url,
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
end;
$$;

grant execute on function public.enqueue_notification(uuid, text, text) to authenticated, anon, service_role;

-- ─── Trigger function — INSERT path ────────────────────────────────────
create or replace function public.trg_sa_fire_booking_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.sa_is_deleted then return null; end if;
  if NEW.contact_id is null then return null; end if;

  perform public.enqueue_notification(NEW.id, 'booking_confirmation', null);
  return null;
end;
$$;

drop trigger if exists trg_sa_after_insert_booking_confirmation on public.service_appointments;
create trigger trg_sa_after_insert_booking_confirmation
  after insert on public.service_appointments
  for each row execute function public.trg_sa_fire_booking_confirmation();

-- ─── Trigger function — UPDATE path ───────────────────────────────────
create or replace function public.trg_sa_fire_status_or_reschedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_new_status text;
  v_event      text;
begin
  if NEW.sa_is_deleted then return null; end if;
  if NEW.contact_id is null then return null; end if;

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
    return null;
  end if;

  if NEW.sa_scheduled_start_time is distinct from OLD.sa_scheduled_start_time then
    perform public.enqueue_notification(NEW.id, 'rescheduled', null);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sa_after_update_lifecycle on public.service_appointments;
create trigger trg_sa_after_update_lifecycle
  after update on public.service_appointments
  for each row execute function public.trg_sa_fire_status_or_reschedule();
