-- No email reaches a customer unless a person approved it.
--
-- Nicholas, 2026-09-03, after LEAP emailed a real property contact "Your home
-- energy assessment is scheduled" about an insulation removal, with a blank
-- date, purely because a field got filled in:
--
--   "Do not ever send out emails without prompting the user to verify. That has
--    to be a hard rule everywhere."
--
-- Until now the rule was the opposite: enqueue_notification POSTs to
-- fire-notification the moment a trigger calls it, and the ONLY thing standing
-- between LEAP and a customer's inbox is whether the appointment happens to
-- carry a contact. A field being populated is not consent to contact somebody.
--
-- So the send becomes a REQUEST. enqueue_notification writes the intent to an
-- outbox and returns; nothing leaves the building until a person opens it,
-- reads who it is going to and what it says, and approves it.
--
-- The switch is a row, not a code path, so a genuinely unattended pipeline can
-- be exempted later without another migration -- but it defaults to REQUIRING
-- APPROVAL, and a missing or unreadable switch also requires approval. The
-- failure direction is always "held", never "sent".

CREATE TABLE IF NOT EXISTS public.outbound_message_approvals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oma_record_number      text NOT NULL DEFAULT '',
  service_appointment_id uuid REFERENCES public.service_appointments(id),
  oma_trigger_event      text NOT NULL,
  oma_channel            text,
  oma_requested_at       timestamptz NOT NULL DEFAULT now(),
  oma_requested_by       uuid REFERENCES public.users(id),
  -- Pending until a person decides. Declined is kept as well as Approved:
  -- "we chose not to contact them" is a fact worth having when a customer
  -- later asks why they heard nothing.
  oma_status             text NOT NULL DEFAULT 'Pending Approval',
  oma_decided_at         timestamptz,
  oma_decided_by         uuid REFERENCES public.users(id),
  oma_decline_reason     text,
  oma_sent_at            timestamptz,
  oma_created_at         timestamptz NOT NULL DEFAULT now(),
  oma_created_by         uuid REFERENCES public.users(id),
  oma_updated_at         timestamptz NOT NULL DEFAULT now(),
  oma_updated_by         uuid REFERENCES public.users(id),
  oma_is_deleted         boolean NOT NULL DEFAULT false,
  oma_deleted_at         timestamptz,
  oma_deleted_by         uuid REFERENCES public.users(id),
  oma_deletion_reason    text,
  CONSTRAINT outbound_message_approvals_status_check
    CHECK (oma_status IN ('Pending Approval', 'Approved', 'Declined', 'Sent'))
);

COMMENT ON TABLE public.outbound_message_approvals IS
  'Every outbound customer message LEAP wants to send, held until a person '
  'approves it. Nicholas, 2026-09-03: "Do not ever send out emails without '
  'prompting the user to verify. That has to be a hard rule everywhere."';

ALTER TABLE public.outbound_message_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_select_outbound_message_approvals ON public.outbound_message_approvals;
CREATE POLICY app_select_outbound_message_approvals ON public.outbound_message_approvals
  FOR SELECT USING ((SELECT public.app_user_can('outbound_message_approvals','read')));
DROP POLICY IF EXISTS app_insert_outbound_message_approvals ON public.outbound_message_approvals;
CREATE POLICY app_insert_outbound_message_approvals ON public.outbound_message_approvals
  FOR INSERT WITH CHECK ((SELECT public.app_user_can('outbound_message_approvals','create')));
DROP POLICY IF EXISTS app_update_outbound_message_approvals ON public.outbound_message_approvals;
CREATE POLICY app_update_outbound_message_approvals ON public.outbound_message_approvals
  FOR UPDATE USING ((SELECT public.app_user_can('outbound_message_approvals','update')))
          WITH CHECK ((SELECT public.app_user_can('outbound_message_approvals','update')));

DROP TRIGGER IF EXISTS trg_outbound_message_approvals_no_hard_delete ON public.outbound_message_approvals;
CREATE TRIGGER trg_outbound_message_approvals_no_hard_delete
  BEFORE DELETE ON public.outbound_message_approvals
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

CREATE TABLE IF NOT EXISTS public.outbound_message_policy (
  omp_key               text PRIMARY KEY,
  omp_requires_approval boolean NOT NULL DEFAULT true,
  omp_note              text,
  omp_updated_at        timestamptz NOT NULL DEFAULT now(),
  omp_updated_by        uuid REFERENCES public.users(id)
);
ALTER TABLE public.outbound_message_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_select_outbound_message_policy ON public.outbound_message_policy;
CREATE POLICY app_select_outbound_message_policy ON public.outbound_message_policy
  FOR SELECT USING ((SELECT public.app_user_can('outbound_message_policy','read')));

INSERT INTO public.outbound_message_policy (omp_key, omp_requires_approval, omp_note)
VALUES ('customer_appointment_email', true,
        'Nicholas, 2026-09-03: no email goes to a customer without a person approving it.')
ON CONFLICT (omp_key) DO NOTHING;

-- enqueue_notification holds instead of sending. The signature, its callers and
-- the two appointment triggers are untouched: they still "request a
-- notification", and what changed is what that means.
-- app.suppress_notifications still short-circuits first, so existing test and
-- migration paths behave exactly as before.
CREATE OR REPLACE FUNCTION public.enqueue_notification(p_service_appointment_id uuid, p_trigger_event text, p_channel text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'net'
AS $function$
declare
  v_url text; v_body jsonb; v_secret text; v_requires_approval boolean;
begin
  if coalesce(current_setting('app.suppress_notifications', true), '') = 'on' then
    return;
  end if;

  -- Default TRUE, and TRUE again if the row is missing: a switch nobody can
  -- read must not become permission to send.
  select omp_requires_approval into v_requires_approval
    from public.outbound_message_policy where omp_key = 'customer_appointment_email';
  v_requires_approval := coalesce(v_requires_approval, true);

  if v_requires_approval then
    insert into public.outbound_message_approvals
      (oma_record_number, service_appointment_id, oma_trigger_event, oma_channel,
       oma_requested_by, oma_created_by, oma_updated_by)
    values
      ('', p_service_appointment_id, p_trigger_event, p_channel,
       public.current_app_user_id(), public.current_app_user_id(), public.current_app_user_id());
    return;
  end if;

  v_url := coalesce(nullif(current_setting('app.fire_notification_url', true), ''),
                    'https://flyjigrijjjtcsvpgzvk.supabase.co/functions/v1/fire-notification');
  v_secret := (select secret from public.internal_cron_auth where name = 'fire_notification');
  v_body := jsonb_build_object('service_appointment_id', p_service_appointment_id,
                               'trigger_event', p_trigger_event);
  if p_channel is not null then
    v_body := v_body || jsonb_build_object('channel', p_channel);
  end if;
  perform net.http_post(url := v_url, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json','x-notification-secret', v_secret));
end;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_oma_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.oma_record_number IS NULL OR NEW.oma_record_number = '' THEN
    SELECT 'OMA-' || lpad((COALESCE(max(substring(oma_record_number from 5)::int), 0) + 1)::text, 5, '0')
      INTO NEW.oma_record_number FROM public.outbound_message_approvals
     WHERE oma_record_number ~ '^OMA-[0-9]+$';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_oma_record_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_oma_rn ON public.outbound_message_approvals;
CREATE TRIGGER trg_oma_rn BEFORE INSERT ON public.outbound_message_approvals
  FOR EACH ROW EXECUTE FUNCTION public.set_oma_record_number();

DO $$
DECLARE v_src text; v_req boolean;
BEGIN
  v_src := pg_get_functiondef('public.enqueue_notification(uuid, text, text)'::regprocedure);
  IF position('outbound_message_approvals' IN v_src) = 0 THEN
    RAISE EXCEPTION 'enqueue_notification no longer records an approval request';
  END IF;
  IF position('coalesce(v_requires_approval, true)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'a missing policy row would no longer default to requiring approval';
  END IF;
  SELECT omp_requires_approval INTO v_req FROM public.outbound_message_policy
   WHERE omp_key = 'customer_appointment_email';
  IF v_req IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'customer appointment email is not set to require approval';
  END IF;
END $$;
