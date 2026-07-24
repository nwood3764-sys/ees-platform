-- =============================================================================
-- create_service_appointment: stamp the customer contact onto the appointment
--
-- The customer-facing booking cascade created the service appointment without
-- setting service_appointments.contact_id. The booking-confirmation trigger
-- (trg_sa_fire_booking_confirmation) — and the whole SA notification pipeline —
-- is gated on contact_id IS NOT NULL, so no confirmation/reminder email ever
-- fired for public self-scheduled bookings.
--
-- Fix: set contact_id = the customer contact on the SA insert. This is correct
-- for assessment / site-visit scheduling (the customer wants confirmation +
-- reminders); install/removal work orders continue to carry no contact_id and
-- so remain unaffected. Only line changed vs. the prior version is the SA
-- INSERT column list (+ contact_id) and its VALUES (+ v_contact_id).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_service_appointment(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_id     uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_slug         text;
  v_start_iso    timestamptz;
  v_end_iso      timestamptz;
  v_resource_id  uuid;
  v_first        text;
  v_last         text;
  v_phone_raw    text;
  v_phone        text;
  v_email        text;
  v_street       text;
  v_city         text;
  v_state        text;
  v_zip          text;
  v_intake       jsonb;
  v_bypass_territory boolean := false;
  v_territory_from_payload uuid;
  v_work_type_id           uuid;
  v_territory_id           uuid;
  v_duration_minutes       numeric;
  v_account_id             uuid;
  v_contact_id             uuid;
  v_property_id            uuid;
  v_building_id            uuid;
  v_unit_id                uuid;
  v_opportunity_id         uuid;
  v_project_id             uuid;
  v_work_order_id          uuid;
  v_service_appointment_id uuid;
  v_sa_record_number       text;
  v_sat_token              text;
  v_scheduled_status_id    uuid;
  v_lock_key               bigint;
  v_sa_day                 date;
  v_conflict_count         integer;
BEGIN
  v_slug        := payload->>'slug';
  v_start_iso   := (payload->>'start_iso')::timestamptz;
  v_end_iso     := (payload->>'end_iso')::timestamptz;
  v_resource_id := (payload->>'resource_id')::uuid;
  v_first       := payload->>'customer_first_name';
  v_last        := payload->>'customer_last_name';
  v_phone_raw   := payload->>'phone';
  v_email       := lower(payload->>'email');
  v_street      := payload->'address'->>'street';
  v_city        := payload->'address'->>'city';
  v_state       := upper(payload->'address'->>'state');
  v_zip         := substring(payload->'address'->>'zip' from 1 for 5);
  v_intake      := COALESCE(payload->'intake', '{}'::jsonb);

  v_bypass_territory := COALESCE((payload->>'bypass_territory_check')::boolean, false)
                    AND current_app_user_id() IS NOT NULL;

  v_phone := regexp_replace(v_phone_raw, '\D', '', 'g');
  IF length(v_phone) = 11 AND left(v_phone, 1) = '1' THEN
    v_phone := substring(v_phone from 2);
  END IF;
  IF length(v_phone) != 10 THEN
    RETURN jsonb_build_object('status','error','message','Phone must be a 10-digit US number.');
  END IF;
  IF v_zip !~ '^\d{5}$' THEN RETURN jsonb_build_object('status','error','message','ZIP must be 5 digits.'); END IF;
  IF length(v_state) != 2 THEN RETURN jsonb_build_object('status','error','message','State must be a 2-letter code.'); END IF;

  SELECT id INTO v_work_type_id FROM work_types
   WHERE work_type_public_slug = v_slug
     AND work_type_is_publicly_schedulable = true
     AND work_type_is_deleted = false
     AND work_type_is_active = true
   LIMIT 1;
  IF v_work_type_id IS NULL THEN RETURN jsonb_build_object('status','error','message','Invalid work type slug.'); END IF;

  v_territory_from_payload := NULLIF(payload->>'territory_id','')::uuid;
  IF v_territory_from_payload IS NOT NULL THEN
    SELECT id INTO v_territory_id FROM service_territories
     WHERE id = v_territory_from_payload
       AND service_territory_is_active = true
       AND service_territory_is_deleted = false;
  END IF;

  IF v_territory_id IS NULL THEN
    SELECT stz.service_territory_id INTO v_territory_id
      FROM service_territory_zips stz
      JOIN service_territories st ON st.id = stz.service_territory_id
     WHERE stz.stz_zip_code = v_zip AND stz.stz_is_deleted = false
       AND st.service_territory_is_active = true AND st.service_territory_is_deleted = false
     LIMIT 1;
  END IF;

  IF v_territory_id IS NULL AND NOT v_bypass_territory THEN
    RETURN jsonb_build_object('status','error','message','Address is outside our service territory.');
  END IF;

  v_duration_minutes := EXTRACT(EPOCH FROM (v_end_iso - v_start_iso)) / 60;

  v_sa_day   := (v_start_iso AT TIME ZONE 'America/Chicago')::date;
  v_lock_key := hashtextextended(v_resource_id::text || ':' || v_sa_day::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT count(*) INTO v_conflict_count
    FROM service_appointment_assignments saa
    JOIN service_appointments sa ON sa.id = saa.service_appointment_id
   WHERE saa.contact_id = v_resource_id
     AND coalesce(saa.saa_is_deleted, false) = false
     AND coalesce(sa.sa_is_deleted, false)  = false
     AND sa.sa_scheduled_start_time < v_end_iso
     AND sa.sa_scheduled_end_time   > v_start_iso;
  IF v_conflict_count > 0 THEN
    RETURN jsonb_build_object('status','slot_taken','message','That time slot was just taken by another customer. Please pick another.');
  END IF;

  SELECT id INTO v_scheduled_status_id FROM picklist_values
   WHERE picklist_object='service_appointments' AND picklist_field='sa_status' AND picklist_value='Scheduled' AND picklist_is_active=true
   LIMIT 1;

  SELECT id, contact_account_id INTO v_contact_id, v_account_id FROM contacts
   WHERE contact_phone = v_phone AND coalesce(contact_is_deleted,false) = false
   LIMIT 1;

  IF v_contact_id IS NULL THEN
    INSERT INTO accounts (account_record_number, account_name, account_phone, account_email, account_owner,
                          account_created_at, account_created_by, account_updated_at, account_updated_by)
    VALUES ('', trim(v_first || ' ' || v_last), v_phone, v_email, v_admin_id,
            now(), v_admin_id, now(), v_admin_id)
    RETURNING id INTO v_account_id;

    INSERT INTO contacts (contact_record_number, contact_name, contact_first_name, contact_last_name,
                          contact_phone, contact_email, contact_account_id, contact_owner,
                          contact_created_at, contact_created_by, contact_updated_at, contact_updated_by)
    VALUES ('', trim(v_first || ' ' || v_last), v_first, v_last,
            v_phone, v_email, v_account_id, v_admin_id,
            now(), v_admin_id, now(), v_admin_id)
    RETURNING id INTO v_contact_id;
  END IF;

  SELECT id INTO v_property_id FROM properties
   WHERE property_account_id = v_account_id
     AND lower(coalesce(property_street,'')) = lower(v_street)
     AND coalesce(property_zip,'') = v_zip
     AND coalesce(property_is_deleted,false) = false
   ORDER BY property_created_at DESC
   LIMIT 1;

  IF v_property_id IS NULL THEN
    INSERT INTO properties (property_record_number, property_name, property_street, property_city,
                            property_state, property_zip, property_account_id, property_owner,
                            property_created_at, property_created_by, property_updated_at, property_updated_by)
    VALUES ('', v_street, v_street, v_city, v_state, v_zip, v_account_id, v_admin_id,
            now(), v_admin_id, now(), v_admin_id)
    RETURNING id INTO v_property_id;
  END IF;

  SELECT id INTO v_building_id FROM buildings
   WHERE property_id = v_property_id AND coalesce(building_is_deleted,false) = false
   ORDER BY building_created_at ASC LIMIT 1;
  IF v_building_id IS NULL THEN
    INSERT INTO buildings (building_record_number, building_name, building_number_or_name,
                           property_id, building_owner,
                           building_created_at, building_created_by, building_updated_at, building_updated_by)
    VALUES ('', v_street, 'Main', v_property_id, v_admin_id,
            now(), v_admin_id, now(), v_admin_id)
    RETURNING id INTO v_building_id;
  END IF;

  SELECT id INTO v_unit_id FROM units
   WHERE building_id = v_building_id AND coalesce(unit_is_deleted,false) = false
   ORDER BY unit_created_at ASC LIMIT 1;
  IF v_unit_id IS NULL THEN
    INSERT INTO units (unit_record_number, unit_name, unit_number, building_id, unit_owner,
                       unit_created_at, unit_created_by, unit_updated_at, unit_updated_by)
    VALUES ('', 'Unit 1', '1', v_building_id, v_admin_id,
            now(), v_admin_id, now(), v_admin_id)
    RETURNING id INTO v_unit_id;
  END IF;

  INSERT INTO opportunities (opportunity_record_number, opportunity_name,
                             opportunity_account_id, property_id, building_id, opportunity_owner,
                             opportunity_created_at, opportunity_created_by, opportunity_updated_at, opportunity_updated_by)
  VALUES ('', trim(v_first || ' ' || v_last) || ' — ' || v_street,
          v_account_id, v_property_id, v_building_id, v_admin_id,
          now(), v_admin_id, now(), v_admin_id)
  RETURNING id INTO v_opportunity_id;

  INSERT INTO projects (project_record_number, project_name,
                        project_account_id, opportunity_id, property_id, building_id, project_owner,
                        project_created_at, project_created_by, project_updated_at, project_updated_by)
  VALUES ('', trim(v_first || ' ' || v_last) || ' — assessment',
          v_account_id, v_opportunity_id, v_property_id, v_building_id, v_admin_id,
          now(), v_admin_id, now(), v_admin_id)
  RETURNING id INTO v_project_id;

  INSERT INTO work_orders (work_order_record_number, work_order_name,
                           work_type_id, property_id, opportunity_id,
                           work_order_account_id, project_id, building_id, unit_id, work_order_owner,
                           work_order_created_at, work_order_created_by, work_order_updated_at, work_order_updated_by)
  VALUES ('', 'WO — assessment',
          v_work_type_id, v_property_id, v_opportunity_id,
          v_account_id, v_project_id, v_building_id, v_unit_id, v_admin_id,
          now(), v_admin_id, now(), v_admin_id)
  RETURNING id INTO v_work_order_id;

  -- contact_id (the customer) is set here so the booking-confirmation trigger
  -- and the SA notification pipeline (gated on contact_id) actually fire.
  INSERT INTO service_appointments (sa_record_number, sa_name, work_order_id, contact_id, sa_owner,
                                    sa_status, sa_scheduled_start_time, sa_scheduled_end_time,
                                    sa_duration_minutes, service_territory_id,
                                    sa_created_at, sa_created_by, sa_updated_at, sa_updated_by)
  VALUES ('', 'SA', v_work_order_id, v_contact_id, v_admin_id,
          v_scheduled_status_id, v_start_iso, v_end_iso,
          v_duration_minutes, v_territory_id,
          now(), v_admin_id, now(), v_admin_id)
  RETURNING id, sa_record_number INTO v_service_appointment_id, v_sa_record_number;

  INSERT INTO service_appointment_assignments (saa_record_number, saa_name,
                                               service_appointment_id, contact_id,
                                               saa_created_at, saa_created_by, saa_updated_at, saa_updated_by,
                                               saa_is_deleted)
  VALUES ('', '',
          v_service_appointment_id, v_resource_id,
          now(), v_admin_id, now(), v_admin_id, false);

  v_sat_token := replace(gen_random_uuid()::text, '-', '');
  INSERT INTO service_appointment_tokens (sat_token, service_appointment_id, sat_purpose, sat_expires_at)
  VALUES (v_sat_token, v_service_appointment_id, 'manage', v_start_iso + interval '7 days');

  RETURN jsonb_build_object(
    'status', 'ok',
    'service_appointment_id',    v_service_appointment_id,
    'sa_record_number',          v_sa_record_number,
    'service_appointment_token', v_sat_token,
    'territory_bypassed',        (v_bypass_territory AND v_territory_id IS NULL)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','error','message',SQLERRM);
END;
$function$;
