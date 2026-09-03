-- A held message can be read, approved, or declined.
--
-- The gate shipped without a handle: enqueue_notification records the intent and
-- nothing can send, which is safe but leaves LEAP unable to confirm an
-- assessment it legitimately booked. These are the three calls the approval
-- screen makes.
--
-- Approving SENDS, so it cannot be a client-side update: the fire-notification
-- shared secret lives in internal_cron_auth and must never reach a browser.
-- Both actions are SECURITY DEFINER and check the caller for themselves.

-- What a person needs before deciding: WHO it goes to, WHAT it says, and what it
-- is about. The recipient and the template are resolved here rather than in the
-- client, so the screen cannot show one thing while the send does another.
CREATE OR REPLACE FUNCTION public.outbound_messages_awaiting_approval()
RETURNS TABLE(
  oma_id uuid, oma_record_number text, requested_at timestamptz,
  trigger_event text, channel text, recipient_name text, recipient_address text,
  subject_line text, body_template text, appointment text, work_order text,
  work_type text, property_name text, scheduled_start timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    o.id, o.oma_record_number, o.oma_requested_at, o.oma_trigger_event,
    COALESCE(o.oma_channel, nt.nt_channel, 'email'),
    NULLIF(trim(concat_ws(' ', c.contact_first_name, c.contact_last_name)), ''),
    -- The address the send would actually use. Returned even when missing,
    -- because "we could not tell who this was going to" is the single most
    -- important thing for the person deciding.
    CASE WHEN COALESCE(o.oma_channel, nt.nt_channel, 'email') = 'sms'
         THEN c.contact_mobile_phone ELSE c.contact_email END,
    nt.nt_subject_line, nt.nt_body,
    sa.sa_record_number, wo.work_order_record_number, wt.work_type_name,
    COALESCE(NULLIF(wo.work_order_property_name,''), p.property_name),
    sa.sa_scheduled_start_time
  FROM public.outbound_message_approvals o
  LEFT JOIN public.service_appointments sa ON sa.id = o.service_appointment_id
  LEFT JOIN public.contacts    c  ON c.id  = sa.contact_id
  LEFT JOIN public.work_orders wo ON wo.id = sa.work_order_id
  LEFT JOIN public.work_types  wt ON wt.id = COALESCE(sa.work_type_id, wo.work_type_id)
  LEFT JOIN public.properties  p  ON p.id  = wo.property_id
  LEFT JOIN LATERAL (
    SELECT t.* FROM public.notification_templates t
     WHERE t.nt_trigger_event = o.oma_trigger_event
       AND t.nt_is_deleted IS NOT TRUE AND t.nt_is_active
       AND (COALESCE(o.oma_channel, 'email') = t.nt_channel OR o.oma_channel IS NULL)
     ORDER BY (t.work_type_id = COALESCE(sa.work_type_id, wo.work_type_id)) DESC NULLS LAST
     LIMIT 1
  ) nt ON TRUE
  WHERE o.oma_is_deleted IS NOT TRUE
    AND o.oma_status = 'Pending Approval'
    AND public.app_user_can('outbound_message_approvals', 'read')
  ORDER BY o.oma_requested_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.outbound_messages_awaiting_approval() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outbound_messages_awaiting_approval() TO authenticated;

-- Approve: the one place a customer message is actually released.
CREATE OR REPLACE FUNCTION public.approve_outbound_message(p_oma_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'net'
AS $function$
DECLARE
  v_caller uuid; v_row public.outbound_message_approvals%ROWTYPE;
  v_url text; v_secret text; v_body jsonb;
BEGIN
  v_caller := public.current_app_user_id();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'approve_outbound_message: caller is not a LEAP user' USING ERRCODE = '28000';
  END IF;
  IF NOT public.app_user_can('outbound_message_approvals', 'update') THEN
    RAISE EXCEPTION 'You do not have permission to approve outbound messages' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.outbound_message_approvals
   WHERE id = p_oma_id AND oma_is_deleted IS NOT TRUE FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That message request no longer exists' USING ERRCODE = 'P0002';
  END IF;
  -- Approving twice must not send twice. The status is the lock.
  IF v_row.oma_status <> 'Pending Approval' THEN
    RETURN jsonb_build_object('outcome','noop','status',v_row.oma_status,
      'message', format('That message was already %s.', lower(v_row.oma_status)));
  END IF;

  v_url := coalesce(nullif(current_setting('app.fire_notification_url', true), ''),
    'https://flyjigrijjjtcsvpgzvk.supabase.co/functions/v1/fire-notification');
  v_secret := (SELECT secret FROM public.internal_cron_auth WHERE name = 'fire_notification');

  v_body := jsonb_build_object('service_appointment_id', v_row.service_appointment_id,
                               'trigger_event', v_row.oma_trigger_event);
  IF v_row.oma_channel IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('channel', v_row.oma_channel);
  END IF;

  -- Stamped BEFORE the post, so a request in flight cannot be approved a second
  -- time by an impatient second click.
  UPDATE public.outbound_message_approvals
     SET oma_status='Sent', oma_decided_at=now(), oma_decided_by=v_caller,
         oma_sent_at=now(), oma_updated_at=now(), oma_updated_by=v_caller
   WHERE id = p_oma_id;

  PERFORM net.http_post(url := v_url, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json',
                                  'x-notification-secret', v_secret));

  RETURN jsonb_build_object('outcome','ok','status','Sent');
END;
$function$;
REVOKE ALL ON FUNCTION public.approve_outbound_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_outbound_message(uuid) TO authenticated;

-- Decline: kept, not deleted. "We chose not to contact them" is a fact worth
-- having when a customer later asks why they heard nothing.
CREATE OR REPLACE FUNCTION public.decline_outbound_message(p_oma_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid; v_status text;
BEGIN
  v_caller := public.current_app_user_id();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'decline_outbound_message: caller is not a LEAP user' USING ERRCODE = '28000';
  END IF;
  IF NOT public.app_user_can('outbound_message_approvals', 'update') THEN
    RAISE EXCEPTION 'You do not have permission to decline outbound messages' USING ERRCODE = '42501';
  END IF;

  SELECT oma_status INTO v_status FROM public.outbound_message_approvals
   WHERE id = p_oma_id AND oma_is_deleted IS NOT TRUE FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That message request no longer exists' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'Pending Approval' THEN
    RETURN jsonb_build_object('outcome','noop','status',v_status);
  END IF;

  UPDATE public.outbound_message_approvals
     SET oma_status='Declined', oma_decided_at=now(), oma_decided_by=v_caller,
         oma_decline_reason=NULLIF(btrim(coalesce(p_reason,'')), ''),
         oma_updated_at=now(), oma_updated_by=v_caller
   WHERE id = p_oma_id;

  RETURN jsonb_build_object('outcome','ok','status','Declined');
END;
$function$;
REVOKE ALL ON FUNCTION public.decline_outbound_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_outbound_message(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_src text;
BEGIN
  v_src := pg_get_functiondef('public.approve_outbound_message(uuid)'::regprocedure);
  IF position('app_user_can(''outbound_message_approvals'', ''update'')' IN v_src) = 0 THEN
    RAISE EXCEPTION 'approve_outbound_message no longer checks the caller';
  END IF;
  -- The double-send guard is the whole reason the status is written first.
  IF position('oma_status <> ''Pending Approval''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'approving twice could send twice';
  END IF;
END $$;
