-- =====================================================================
-- Customers must NEVER receive an email or SMS about work orders /
-- service appointments — no booking confirmations, no reminders, no
-- lifecycle updates (on my way / arrived / completed / canceled /
-- rescheduled). Standing business rule from Nicholas, 2026-07-13.
--
-- This removes the entire customer-notification pathway:
--   1. SA insert trigger (booking confirmation)
--   2. SA update trigger (status / reschedule lifecycle events)
--   3. dispatch_due_reminders cron job + function (48h / 24h /
--      morning-of reminders)
--   4. enqueue_notification (the only bridge to the fire-notification
--      edge function; with all callers gone it is dropped so the path
--      cannot be silently resurrected)
--   5. Customer-facing notification templates NT-00001..NT-00013
--      deactivated (kept for history, inactive). NT-00014 (Dispatcher
--      Follow-up Required — internal audience) is left untouched.
--
-- notification_logs is retained as history. The fire-notification edge
-- function remains deployed but has no remaining callers.
--
-- Applied to production 2026-07-13 via MCP (version 20260713121244).
-- =====================================================================

-- 1 + 2. Service appointment triggers ----------------------------------------
DROP TRIGGER IF EXISTS trg_sa_after_insert_booking_confirmation ON public.service_appointments;
DROP TRIGGER IF EXISTS trg_sa_after_update_lifecycle ON public.service_appointments;
DROP FUNCTION IF EXISTS public.trg_sa_fire_booking_confirmation();
DROP FUNCTION IF EXISTS public.trg_sa_fire_status_or_reschedule();

-- 3. Reminder cron + function --------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dispatch_due_reminders'
  ) THEN
    PERFORM cron.unschedule('dispatch_due_reminders');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.dispatch_due_reminders();

-- 4. The dispatcher bridge ------------------------------------------------------
DROP FUNCTION IF EXISTS public.enqueue_notification(uuid, text, text);

-- 5. Deactivate customer-facing templates (keep rows for history) ----------------
UPDATE public.notification_templates
   SET nt_is_active = false
 WHERE nt_is_deleted IS NOT TRUE
   AND nt_trigger_event IN (
     'booking_confirmation', 'reminder_48hr', 'reminder_24hr',
     'reminder_morning_of', 'on_my_way', 'arrived', 'completed',
     'canceled', 'rescheduled'
   );

NOTIFY pgrst, 'reload schema';
