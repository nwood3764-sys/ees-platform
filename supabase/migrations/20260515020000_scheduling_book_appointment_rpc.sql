-- =============================================================================
-- book_appointment(payload jsonb) → jsonb
--
-- Transactional RPC called by the public book-appointment edge function.
-- Creates the full 10-table cascade for a customer-self-booked assessment:
--   Account (dedup by Contact phone)
--   Contact (looked up by phone first; created if not found)
--   Property → Building → Unit (1:1:1 for single-family/townhome)
--   Opportunity → Project (record_type = work_type.default_project_record_type)
--   Work Order (record_type=General; work_type_id=booked work type)
--   Service Appointment (status=scheduled; chosen slot)
--   Service Appointment Assignment (links SA → chosen Tech)
--   Booking Token (bt_purpose='manage'; expires 7 days after appt start)
--
-- Concurrency: pg_advisory_xact_lock on (resource_id, calendar_day) serializes
-- bookings against the same Tech on the same day. Post-lock, the function
-- re-checks for slot conflicts (with 15-min buffer); if any, returns
-- status='slot_taken'. Auto-released at transaction end.
--
-- Notification: in v1, no SMS/email is fired here (transports not configured —
-- A2P 10DLC + Mail.Send are parallel workstreams). The edge function attaches
-- a customer-facing `manage_url` to the response.
--
-- This is the consolidated final version of the RPC. Production migration
-- history shows 7 iterative migrations (see supabase_migrations.schema_migrations);
-- this file is the source-of-truth definition.
-- =============================================================================

CREATE OR REPLACE FUNCTION book_appointment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_slug       text  := payload->>'slug';
  v_start_iso  timestamptz := (payload->>'start_iso')::timestamptz;
  v_end_iso    timestamptz := (payload->>'end_iso')::timestamptz;
  v_resource_id uuid := (payload->>'resource_id')::uuid;
  v_first      text  := payload->>'customer_first_name';
  v_last       text  := payload->>'customer_last_name';
  v_phone_raw  text  := payload->>'phone';
  v_phone      text;
  v_email      text  := payload->>'email';
  v_street     text  := payload->'address'->>'street';
  v_city       text  := payload->'address'->>'city';
  v_state      text  := upper(payload->'address'->>'state');
  v_zip_raw    text  := payload->'address'->>'zip';
  v_zip        text;
  v_work_type_id            uuid;
  v_work_type_name          text;
  v_project_record_type     uuid;
  v_service_territory_id    uuid;
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  v_conflict_count          int;
  v_account_id     uuid;
  v_contact_id     uuid;
  v_property_id    uuid;
  v_building_id    uuid;
  v_unit_id        uuid;
  v_opportunity_id uuid;
  v_project_id     uuid;
  v_work_order_id  uuid;
  v_service_appointment_id uuid;
  v_booking_token  text;
  v_sa_status_id        uuid;
  v_account_rt_id       uuid;
  v_contact_rt_id       uuid;
  v_wo_rt_id            uuid;
  v_resource_full_name  text;
BEGIN
  -- Normalize phone (10 digits exactly, no formatting; honor contacts CHECK constraint).
  v_phone := regexp_replace(coalesce(v_phone_raw, ''), '[^0-9]', '', 'g');
  IF length(v_phone) = 11 AND left(v_phone, 1) = '1' THEN
    v_phone := substring(v_phone from 2);
  END IF;
  IF v_phone !~ '^\d{10}$' THEN
    RETURN jsonb_build_object('status','invalid_phone','message','Phone must be a 10-digit US number');
  END IF;

  v_zip := substring(regexp_replace(coalesce(v_zip_raw, ''), '[^0-9]', '', 'g') from 1 for 5);
  IF v_zip !~ '^\d{5}$' THEN
    RETURN jsonb_build_object('status','invalid_zip','message','ZIP must be 5 digits');
  END IF;
  IF v_state IS NULL OR char_length(v_state) <> 2 THEN
    RETURN jsonb_build_object('status','invalid_state','message','State must be 2-character code');
  END IF;

  SELECT wt.id, wt.work_type_name, wt.work_type_default_project_record_type
    INTO v_work_type_id, v_work_type_name, v_project_record_type
    FROM work_types wt
   WHERE wt.work_type_public_slug = v_slug AND wt.work_type_is_publicly_bookable = true
     AND wt.work_type_is_deleted = false AND wt.work_type_is_active = true LIMIT 1;
  IF v_work_type_id IS NULL THEN
    RETURN jsonb_build_object('status','invalid_work_type','message','Unknown or not-bookable work type slug');
  END IF;

  SELECT c.contact_first_name || ' ' || c.contact_last_name INTO v_resource_full_name
    FROM contacts c WHERE c.id = v_resource_id AND c.contact_is_deleted = false LIMIT 1;
  IF v_resource_full_name IS NULL THEN
    RETURN jsonb_build_object('status','invalid_resource','message','Resource not found');
  END IF;

  SELECT stz.service_territory_id INTO v_service_territory_id
    FROM service_territory_zips stz
    JOIN service_territories st ON st.id = stz.service_territory_id
   WHERE stz.stz_zip_code = v_zip AND stz.stz_is_deleted = false
     AND st.service_territory_is_active = true AND st.service_territory_is_deleted = false LIMIT 1;
  IF v_service_territory_id IS NULL THEN
    RETURN jsonb_build_object('status','out_of_territory','message','Address ZIP is outside our service area');
  END IF;

  -- Serialize concurrent bookings against the same resource on the same day.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_resource_id::text || '|' || (v_start_iso AT TIME ZONE 'America/Chicago')::date::text, 0)
  );

  SELECT count(*) INTO v_conflict_count
    FROM service_appointments sa
    JOIN service_appointment_assignments saa ON saa.service_appointment_id = sa.id
   WHERE saa.contact_id = v_resource_id AND saa.saa_is_deleted = false AND sa.sa_is_deleted = false
     AND sa.sa_scheduled_start_time < (v_end_iso + interval '15 minutes')
     AND sa.sa_scheduled_end_time   > (v_start_iso - interval '15 minutes');
  IF v_conflict_count > 0 THEN
    RETURN jsonb_build_object('status','slot_taken','message','That slot was just booked. Please pick another.');
  END IF;

  -- Resolve picklist FKs once.
  SELECT id INTO v_sa_status_id FROM picklist_values
   WHERE picklist_object='service_appointments' AND picklist_field='status' AND picklist_value='scheduled' AND picklist_is_active=true LIMIT 1;
  SELECT id INTO v_account_rt_id FROM picklist_values
   WHERE picklist_object='accounts' AND picklist_field='record_type' AND picklist_value='Single_Family' AND picklist_is_active=true LIMIT 1;
  SELECT id INTO v_contact_rt_id FROM picklist_values
   WHERE picklist_object='contacts' AND picklist_field='record_type' AND picklist_value='Standard_Contact' AND picklist_is_active=true LIMIT 1;
  SELECT id INTO v_wo_rt_id FROM picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='record_type' AND picklist_value='General' AND picklist_is_active=true LIMIT 1;

  -- Dedup by contact phone. Reuse Account if existing contact found.
  SELECT c.id, c.contact_account_id INTO v_contact_id, v_account_id
    FROM contacts c WHERE c.contact_phone = v_phone AND c.contact_is_deleted = false
   ORDER BY c.contact_created_at DESC LIMIT 1;

  IF v_account_id IS NULL THEN
    INSERT INTO accounts (account_record_number, account_name, account_record_type, account_phone, account_email, account_owner, account_created_by)
    VALUES ('', v_first || ' ' || v_last, v_account_rt_id, v_phone, v_email, v_owner, v_owner) RETURNING id INTO v_account_id;
  END IF;
  IF v_contact_id IS NULL THEN
    INSERT INTO contacts (contact_record_number, contact_name, contact_first_name, contact_last_name, contact_phone, contact_email, contact_account_id, contact_record_type, contact_owner, contact_created_by)
    VALUES ('', v_first || ' ' || v_last, v_first, v_last, v_phone, v_email, v_account_id, v_contact_rt_id, v_owner, v_owner) RETURNING id INTO v_contact_id;
  END IF;

  INSERT INTO properties (property_record_number, property_name, property_street, property_city, property_state, property_zip, property_account_id, property_owner, property_created_by)
  VALUES ('', v_street || ', ' || v_city, v_street, v_city, v_state, v_zip, v_account_id, v_owner, v_owner) RETURNING id INTO v_property_id;
  INSERT INTO buildings (building_record_number, building_name, building_number_or_name, property_id, building_owner, building_created_by)
  VALUES ('', 'Main Building', '1', v_property_id, v_owner, v_owner) RETURNING id INTO v_building_id;
  INSERT INTO units (unit_record_number, unit_name, unit_number, building_id, unit_owner, unit_created_by)
  VALUES ('', 'Main Unit', '1', v_building_id, v_owner, v_owner) RETURNING id INTO v_unit_id;
  INSERT INTO opportunities (opportunity_record_number, opportunity_name, opportunity_account_id, property_id, building_id, opportunity_owner, opportunity_created_by)
  VALUES ('', v_work_type_name || ' — ' || v_street, v_account_id, v_property_id, v_building_id, v_owner, v_owner) RETURNING id INTO v_opportunity_id;
  INSERT INTO projects (project_record_number, project_name, project_account_id, property_id, building_id, opportunity_id, project_record_type, project_owner, project_created_by)
  VALUES ('', v_work_type_name || ' — ' || v_street, v_account_id, v_property_id, v_building_id, v_opportunity_id, v_project_record_type, v_owner, v_owner) RETURNING id INTO v_project_id;
  INSERT INTO work_orders (work_order_record_number, work_order_name, project_id, property_id, building_id, unit_id, opportunity_id, work_type_id, work_order_record_type, work_order_owner, work_order_created_by)
  VALUES ('', v_work_type_name || ' — ' || v_street, v_project_id, v_property_id, v_building_id, v_unit_id, v_opportunity_id, v_work_type_id, v_wo_rt_id, v_owner, v_owner) RETURNING id INTO v_work_order_id;
  INSERT INTO service_appointments (sa_record_number, sa_name, work_order_id, service_territory_id, sa_scheduled_start_time, sa_scheduled_end_time, sa_status, sa_owner, sa_created_by)
  VALUES ('', v_work_type_name || ' — ' || v_first || ' ' || v_last, v_work_order_id, v_service_territory_id, v_start_iso, v_end_iso, v_sa_status_id, v_owner, v_owner) RETURNING id INTO v_service_appointment_id;
  INSERT INTO service_appointment_assignments (saa_record_number, saa_name, service_appointment_id, contact_id, saa_created_by)
  VALUES ('', 'Primary: ' || v_resource_full_name, v_service_appointment_id, v_resource_id, v_owner);

  -- 32-hex-char token (122 bits entropy from gen_random_uuid; URL-safe).
  v_booking_token := replace(gen_random_uuid()::text, '-', '');

  -- booking_tokens is a lean table — no record_number, owner, created_by columns.
  INSERT INTO booking_tokens (bt_token, service_appointment_id, bt_purpose, bt_expires_at)
  VALUES (v_booking_token, v_service_appointment_id, 'manage', v_start_iso + interval '7 days');

  RETURN jsonb_build_object(
    'status','ok',
    'service_appointment_id', v_service_appointment_id,
    'work_order_id', v_work_order_id,
    'project_id', v_project_id,
    'opportunity_id', v_opportunity_id,
    'account_id', v_account_id,
    'contact_id', v_contact_id,
    'property_id', v_property_id,
    'booking_token', v_booking_token
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','error','message', SQLERRM, 'sqlstate', SQLSTATE);
END;
$func$;

REVOKE ALL ON FUNCTION book_appointment(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION book_appointment(jsonb) TO service_role;

-- Update MF Energy Assessment skill requirement: BPI Building Analyst → BPI MFBA
-- (single-family-focused auditor isn't qualified to walk a 4-plex).
UPDATE work_type_skill_requirements wtsr
SET wtsr_is_deleted = true,
    wtsr_deleted_at = now(),
    wtsr_deleted_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
FROM work_types wt, skills s
WHERE wtsr.work_type_id = wt.id
  AND wtsr.skill_id     = s.id
  AND wt.work_type_name = 'Multifamily Energy Assessment'
  AND s.skill_name      = 'BPI Building Analyst'
  AND wtsr.wtsr_is_deleted = false;

INSERT INTO work_type_skill_requirements (
  wtsr_record_number, work_type_id, skill_id, wtsr_minimum_level,
  wtsr_owner, wtsr_created_by
)
SELECT '',
       (SELECT id FROM work_types WHERE work_type_name='Multifamily Energy Assessment'),
       (SELECT id FROM skills WHERE skill_name='BPI Multifamily Building Analyst' AND skill_is_deleted=false),
       1,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM work_type_skill_requirements wtsr
  WHERE wtsr.work_type_id = (SELECT id FROM work_types WHERE work_type_name='Multifamily Energy Assessment')
    AND wtsr.skill_id = (SELECT id FROM skills WHERE skill_name='BPI Multifamily Building Analyst' AND skill_is_deleted=false)
    AND wtsr.wtsr_is_deleted = false
);
