-- ─────────────────────────────────────────────────────────────────────────────
-- Scheduling terminology cleanup.
--
-- Renames stale identifiers carried over from an earlier naming pass to
-- canonical Service Appointment terminology. The customer schedules a
-- Service Appointment; staff manages a Service Appointment; the table is
-- service_appointments; the record-number prefix is SA-.
--
-- After this migration:
--   table  service_appointment_tokens  (with sat_* column prefix)
--   RPC    create_service_appointment(jsonb)
--   RPC    lookup_service_appointment_by_token(text)
--   RPC    cancel_appointment(text)
--   RPC    reschedule_appointment(text, timestamptz, timestamptz, uuid)
--   JSON   service_appointment_token result key on successful create
--
-- The DROP FUNCTION + ALTER TABLE RENAME statements below reference the old
-- identifier strings out of syntactic necessity — that's how rename SQL is
-- expressed. Everything else uses the canonical names.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Drop old RPCs that referenced the now-renamed table/columns ────────────
DROP FUNCTION IF EXISTS public.book_appointment(jsonb);
DROP FUNCTION IF EXISTS public.lookup_booking_by_token(text);
DROP FUNCTION IF EXISTS public.cancel_appointment(text);
DROP FUNCTION IF EXISTS public.reschedule_appointment(text, timestamptz, timestamptz, uuid);

-- ─── Rename table + columns (idempotent guards) ─────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'booking_tokens') THEN
    ALTER TABLE public.booking_tokens RENAME TO service_appointment_tokens;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='service_appointment_tokens' AND column_name='bt_token') THEN
    ALTER TABLE public.service_appointment_tokens RENAME COLUMN bt_token          TO sat_token;
    ALTER TABLE public.service_appointment_tokens RENAME COLUMN bt_purpose        TO sat_purpose;
    ALTER TABLE public.service_appointment_tokens RENAME COLUMN bt_expires_at     TO sat_expires_at;
    ALTER TABLE public.service_appointment_tokens RENAME COLUMN bt_consumed_at    TO sat_consumed_at;
    ALTER TABLE public.service_appointment_tokens RENAME COLUMN bt_consumed_by_ip TO sat_consumed_by_ip;
    ALTER TABLE public.service_appointment_tokens RENAME COLUMN bt_created_at     TO sat_created_at;
  END IF;
END $$;

-- ─── lookup_service_appointment_by_token(text) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_service_appointment_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sat                 service_appointment_tokens%rowtype;
  v_sa                  service_appointments%rowtype;
  v_wo_property_id      uuid;
  v_wo_opportunity_id   uuid;
  v_wo_work_type_id     uuid;
  v_wt_name             text;
  v_wt_slug             text;
  v_prop_street         text;
  v_prop_city           text;
  v_prop_state          text;
  v_prop_zip            text;
  v_opp_account_id      uuid;
  v_acc_name            text;
  v_acc_phone           text;
  v_acc_email           text;
  v_terr_name           text;
  v_aud_first           text;
  v_aud_last            text;
  v_aud_id              uuid;
  v_status_val          text;
BEGIN
  IF p_token IS NULL OR length(p_token) != 32 THEN
    RETURN jsonb_build_object('status', 'invalid_token');
  END IF;

  SELECT * INTO v_sat FROM service_appointment_tokens WHERE sat_token = p_token;
  IF v_sat.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_token');
  END IF;
  IF v_sat.sat_expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired_token');
  END IF;

  SELECT * INTO v_sa FROM service_appointments
   WHERE id = v_sat.service_appointment_id AND sa_is_deleted = false;
  IF v_sa.id IS NULL THEN
    RETURN jsonb_build_object('status', 'appointment_not_found');
  END IF;

  SELECT property_id, opportunity_id, work_type_id
    INTO v_wo_property_id, v_wo_opportunity_id, v_wo_work_type_id
    FROM work_orders WHERE id = v_sa.work_order_id;

  SELECT work_type_name, work_type_public_slug
    INTO v_wt_name, v_wt_slug
    FROM work_types WHERE id = v_wo_work_type_id;

  SELECT property_street, property_city, property_state, property_zip
    INTO v_prop_street, v_prop_city, v_prop_state, v_prop_zip
    FROM properties WHERE id = v_wo_property_id;

  SELECT opportunity_account_id INTO v_opp_account_id
    FROM opportunities WHERE id = v_wo_opportunity_id;

  SELECT account_name, account_phone, account_email
    INTO v_acc_name, v_acc_phone, v_acc_email
    FROM accounts WHERE id = v_opp_account_id;

  SELECT service_territory_name INTO v_terr_name
    FROM service_territories WHERE id = v_sa.service_territory_id;

  SELECT c.id, c.contact_first_name, c.contact_last_name
    INTO v_aud_id, v_aud_first, v_aud_last
    FROM service_appointment_assignments saa
    JOIN contacts c ON c.id = saa.contact_id
   WHERE saa.service_appointment_id = v_sa.id
     AND saa.saa_is_deleted = false
   LIMIT 1;

  SELECT picklist_value INTO v_status_val
    FROM picklist_values WHERE id = v_sa.sa_status;

  RETURN jsonb_build_object(
    'status', 'ok',
    'service_appointment_id', v_sa.id,
    'sa_record_number',       v_sa.sa_record_number,
    'sa_status',              v_status_val,
    'sa_scheduled_start_iso', v_sa.sa_scheduled_start_time,
    'sa_scheduled_end_iso',   v_sa.sa_scheduled_end_time,
    'duration_minutes',       v_sa.sa_duration_minutes,
    'work_type_name',         v_wt_name,
    'work_type_slug',         v_wt_slug,
    'address', jsonb_build_object(
      'street', v_prop_street, 'city', v_prop_city,
      'state',  v_prop_state,  'zip',  v_prop_zip
    ),
    'customer', jsonb_build_object(
      'name',  v_acc_name, 'phone', v_acc_phone, 'email', v_acc_email
    ),
    'territory_name', v_terr_name,
    'auditor_id',     v_aud_id,
    'auditor_name',   trim(coalesce(v_aud_first,'') || ' ' || coalesce(v_aud_last,'')),
    'token_expires_at', v_sat.sat_expires_at,
    'token_consumed',   v_sat.sat_consumed_at IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_service_appointment_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_service_appointment_by_token(text) TO anon, authenticated;

-- ─── cancel_appointment(text) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_appointment(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sat         service_appointment_tokens%rowtype;
  v_sa          service_appointments%rowtype;
  v_canceled_id uuid;
  v_admin_id    uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
BEGIN
  IF p_token IS NULL OR length(p_token) != 32 THEN
    RETURN jsonb_build_object('status', 'invalid_token');
  END IF;

  SELECT * INTO v_sat FROM service_appointment_tokens WHERE sat_token = p_token;
  IF v_sat.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_token');
  END IF;
  IF v_sat.sat_expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired_token');
  END IF;
  IF v_sat.sat_consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_consumed',
                              'message', 'This appointment has already been canceled.');
  END IF;

  SELECT * INTO v_sa FROM service_appointments
   WHERE id = v_sat.service_appointment_id AND sa_is_deleted = false;
  IF v_sa.id IS NULL THEN
    RETURN jsonb_build_object('status', 'appointment_not_found');
  END IF;

  IF v_sa.sa_scheduled_start_time < now() THEN
    RETURN jsonb_build_object('status', 'too_late',
                              'message', 'Cannot cancel an appointment that has already started or passed. Contact Energy Efficiency Services for assistance.');
  END IF;

  SELECT id INTO v_canceled_id
    FROM picklist_values
   WHERE picklist_object = 'service_appointments'
     AND picklist_field  = 'status'
     AND picklist_value  = 'canceled'
     AND picklist_is_active = true
   LIMIT 1;
  IF v_canceled_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Cancel status not configured.');
  END IF;

  UPDATE service_appointments
     SET sa_status     = v_canceled_id,
         sa_updated_at = now(),
         sa_updated_by = v_admin_id
   WHERE id = v_sa.id;

  UPDATE service_appointment_tokens
     SET sat_consumed_at = now()
   WHERE id = v_sat.id;

  RETURN jsonb_build_object('status', 'ok',
                            'service_appointment_id', v_sa.id,
                            'sa_record_number',       v_sa.sa_record_number);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_appointment(text) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_appointment(text) TO anon, authenticated;

-- ─── reschedule_appointment(text, timestamptz, timestamptz, uuid) ───────────
CREATE OR REPLACE FUNCTION public.reschedule_appointment(
  p_token             text,
  p_new_start_iso     timestamptz,
  p_new_end_iso       timestamptz,
  p_new_resource_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sat             service_appointment_tokens%rowtype;
  v_sa              service_appointments%rowtype;
  v_sa_day_chi      date;
  v_lock_key        bigint;
  v_conflict_count  integer;
  v_resource_exists boolean;
  v_admin_id        uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
BEGIN
  IF p_token IS NULL OR length(p_token) != 32 THEN
    RETURN jsonb_build_object('status', 'invalid_token');
  END IF;

  SELECT * INTO v_sat FROM service_appointment_tokens WHERE sat_token = p_token;
  IF v_sat.id IS NULL THEN RETURN jsonb_build_object('status', 'invalid_token'); END IF;
  IF v_sat.sat_expires_at < now() THEN RETURN jsonb_build_object('status', 'expired_token'); END IF;
  IF v_sat.sat_consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_consumed',
                              'message', 'This appointment has already been canceled.');
  END IF;

  SELECT * INTO v_sa FROM service_appointments
   WHERE id = v_sat.service_appointment_id AND sa_is_deleted = false;
  IF v_sa.id IS NULL THEN RETURN jsonb_build_object('status', 'appointment_not_found'); END IF;

  IF v_sa.sa_scheduled_start_time < now() THEN
    RETURN jsonb_build_object('status', 'too_late',
                              'message', 'Cannot reschedule an appointment that has already started or passed.');
  END IF;

  IF p_new_start_iso IS NULL OR p_new_end_iso IS NULL OR p_new_start_iso >= p_new_end_iso THEN
    RETURN jsonb_build_object('status', 'invalid_slot');
  END IF;
  IF p_new_start_iso < now() THEN
    RETURN jsonb_build_object('status', 'past_slot');
  END IF;
  IF p_new_resource_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_resource');
  END IF;

  SELECT true INTO v_resource_exists
    FROM contacts
   WHERE id = p_new_resource_id
     AND coalesce(contact_is_deleted, false) = false;
  IF v_resource_exists IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_resource');
  END IF;

  v_sa_day_chi := (p_new_start_iso AT TIME ZONE 'America/Chicago')::date;
  v_lock_key   := hashtextextended(p_new_resource_id::text || ':' || v_sa_day_chi::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT count(*) INTO v_conflict_count
    FROM service_appointment_assignments saa
    JOIN service_appointments sa2 ON sa2.id = saa.service_appointment_id
   WHERE saa.contact_id = p_new_resource_id
     AND coalesce(saa.saa_is_deleted, false) = false
     AND coalesce(sa2.sa_is_deleted, false)  = false
     AND sa2.id != v_sa.id
     AND sa2.sa_scheduled_start_time < p_new_end_iso
     AND sa2.sa_scheduled_end_time   > p_new_start_iso;

  IF v_conflict_count > 0 THEN
    RETURN jsonb_build_object('status', 'slot_taken',
                              'message', 'That time slot was just taken. Please pick another.');
  END IF;

  UPDATE service_appointments
     SET sa_scheduled_start_time = p_new_start_iso,
         sa_scheduled_end_time   = p_new_end_iso,
         sa_updated_at           = now(),
         sa_updated_by           = v_admin_id
   WHERE id = v_sa.id;

  UPDATE service_appointment_assignments
     SET saa_is_deleted      = true,
         saa_deleted_at      = now(),
         saa_deleted_by      = v_admin_id,
         saa_deletion_reason = 'rescheduled by customer'
   WHERE service_appointment_id = v_sa.id
     AND coalesce(saa_is_deleted, false) = false;

  INSERT INTO service_appointment_assignments (
    saa_record_number, saa_name,
    service_appointment_id, contact_id,
    saa_created_at, saa_created_by,
    saa_updated_at, saa_updated_by,
    saa_is_deleted
  ) VALUES (
    '', '',
    v_sa.id, p_new_resource_id,
    now(), v_admin_id,
    now(), v_admin_id,
    false
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'service_appointment_id', v_sa.id,
    'sa_record_number',       v_sa.sa_record_number,
    'sa_scheduled_start_iso', p_new_start_iso,
    'sa_scheduled_end_iso',   p_new_end_iso
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_appointment(text, timestamptz, timestamptz, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment(text, timestamptz, timestamptz, uuid) TO anon, authenticated;
