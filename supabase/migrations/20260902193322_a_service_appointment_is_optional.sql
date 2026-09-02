-- ============================================================================
-- A service appointment is OPTIONAL. A work order assigned to a technician and
-- scheduled for today reaches their LEAP Pad whether or not one exists.
--
-- Nicholas, 2026-09-02: "he can not see the insulation work order" … "we don't
-- need an appointment" … "service appointments are optional."
--
-- WO-00244 (Insulation Removal - Attic, 3002 West Darling Street) already
-- carried everything needed: assigned_technician_id = Roman Rufino, and
-- work_order_scheduled_start_date = that day. It said "Scheduled" on the record
-- page. It was invisible in the field anyway, because my_service_appointments
-- was written `FROM service_appointments` with no other route in — so a work
-- order with no appointment row could not appear for ANYONE, however it was
-- assigned, owned or dated. The data was right; the query was the whole defect.
--
-- That is not a one-record accident. Of 128 live work orders, 28 have no
-- appointment. Every one of them is currently invisible to the field, and the
-- record page tells the office they are scheduled — the schedule and the
-- appointment are two different facts and only one of them reached the phone.
--
-- The rule now: a stop is on my day when EITHER
--   (a) an appointment on that date has me as assigned crew, or I coordinate it
--       — unchanged, byte for byte, so nobody's existing schedule moves; or
--   (b) the WORK ORDER itself names me and is scheduled for that date, and it
--       has no appointment to carry it.
--
-- Deduplication is by construction, not by DISTINCT: branch (b) takes only work
-- orders with NO live appointment at all. If somebody made an appointment, the
-- appointment IS the schedule and it wins — including its time window, which a
-- bare work order does not have.
--
-- A direct-assigned stop has no times, so it sorts last (ORDER BY … NULLS
-- LAST, already the behaviour) and the client already renders a missing time as
-- "—". No client change is required for it to appear correctly.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.my_service_appointments(
  p_date date DEFAULT ((now() AT TIME ZONE 'America/Chicago'::text))::date)
RETURNS TABLE(
  sa_id uuid, sa_record_number text, sa_status text,
  sa_scheduled_start_time timestamp with time zone,
  sa_scheduled_end_time timestamp with time zone,
  sa_duration_minutes numeric,
  work_order_id uuid, work_order_record_number text, work_order_name text,
  work_order_status text, work_type_name text, property_name text,
  property_address text, building text, unit text, customer_name text,
  my_role text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  -- ── (a) Appointment-driven stops — UNCHANGED ────────────────────────────
  SELECT
    sa.id, sa.sa_record_number, sast.picklist_value,
    sa.sa_scheduled_start_time, sa.sa_scheduled_end_time, sa.sa_duration_minutes,
    wo.id, wo.work_order_record_number, wo.work_order_name, wost.picklist_value,
    wt.work_type_name,
    COALESCE(NULLIF(wo.work_order_property_name,''), p.property_name),
    NULLIF(trim(BOTH ', ' FROM concat_ws(', ',
      COALESCE(NULLIF(wo.work_order_building_address,''), b.building_address, p.property_street),
      COALESCE(b.building_city, p.property_city),
      COALESCE(b.building_state, p.property_state),
      COALESCE(b.building_zip, p.property_zip)
    )), ''),
    COALESCE(NULLIF(wo.work_order_building,''), b.building_number_or_name, b.building_name),
    COALESCE(NULLIF(wo.work_order_unit,''), u.unit_number, u.unit_name),
    wo.work_order_customer_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.service_appointment_assignments saa
        WHERE saa.service_appointment_id = sa.id
          AND saa.saa_is_deleted IS NOT TRUE
          AND saa.saa_user_id = public.current_app_user_id()
      ) THEN 'Assigned'
      ELSE 'Coordinating'
    END
  FROM public.service_appointments sa
  LEFT JOIN public.work_orders wo
    ON wo.id = sa.work_order_id AND wo.work_order_is_deleted IS NOT TRUE
  LEFT JOIN public.projects pr
    ON pr.id = COALESCE(sa.project_id, wo.project_id) AND pr.project_is_deleted IS NOT TRUE
  LEFT JOIN public.work_types wt ON wt.id = sa.work_type_id
  LEFT JOIN public.picklist_values sast ON sast.id = sa.sa_status
  LEFT JOIN public.picklist_values wost ON wost.id = wo.work_order_status
  LEFT JOIN public.properties p ON p.id = wo.property_id
  LEFT JOIN public.buildings  b ON b.id = wo.building_id
  LEFT JOIN public.units      u ON u.id = wo.unit_id
  WHERE sa.sa_is_deleted IS NOT TRUE
    AND (sa.sa_scheduled_start_time AT TIME ZONE 'America/Chicago')::date = p_date
    AND (
      EXISTS (
        SELECT 1 FROM public.service_appointment_assignments saa
        WHERE saa.service_appointment_id = sa.id
          AND saa.saa_is_deleted IS NOT TRUE
          AND saa.saa_user_id = public.current_app_user_id()
      )
      OR wo.project_coordinator_id = public.current_app_user_id()
      OR pr.project_coordinator_id = public.current_app_user_id()
    )

  UNION ALL

  -- ── (b) The work order carries itself ───────────────────────────────────
  -- No appointment, so no appointment columns: those come back NULL and the
  -- screen shows "—" for the time, which is the truth. What it is NOT allowed
  -- to be is absent.
  SELECT
    NULL::uuid, NULL::text, NULL::text,
    NULL::timestamptz, NULL::timestamptz, NULL::numeric,
    wo.id, wo.work_order_record_number, wo.work_order_name, wost.picklist_value,
    wt.work_type_name,
    COALESCE(NULLIF(wo.work_order_property_name,''), p.property_name),
    NULLIF(trim(BOTH ', ' FROM concat_ws(', ',
      COALESCE(NULLIF(wo.work_order_building_address,''), b.building_address, p.property_street),
      COALESCE(b.building_city, p.property_city),
      COALESCE(b.building_state, p.property_state),
      COALESCE(b.building_zip, p.property_zip)
    )), ''),
    COALESCE(NULLIF(wo.work_order_building,''), b.building_number_or_name, b.building_name),
    COALESCE(NULLIF(wo.work_order_unit,''), u.unit_number, u.unit_name),
    wo.work_order_customer_name,
    -- Doing the work outranks coordinating it: somebody who is both sees their
    -- own stop, not a supervisory badge on it.
    CASE
      WHEN wo.assigned_technician_id   = public.current_app_user_id()
        OR wo.project_site_lead_user_id = public.current_app_user_id()
      THEN 'Assigned'
      ELSE 'Coordinating'
    END
  FROM public.work_orders wo
  LEFT JOIN public.projects pr
    ON pr.id = wo.project_id AND pr.project_is_deleted IS NOT TRUE
  LEFT JOIN public.work_types wt ON wt.id = wo.work_type_id
  LEFT JOIN public.picklist_values wost ON wost.id = wo.work_order_status
  LEFT JOIN public.properties p ON p.id = wo.property_id
  LEFT JOIN public.buildings  b ON b.id = wo.building_id
  LEFT JOIN public.units      u ON u.id = wo.unit_id
  WHERE wo.work_order_is_deleted IS NOT TRUE
    -- Scheduled for this day, by whichever column the office filled in.
    AND COALESCE(
          wo.work_order_scheduled_start_date,
          (wo.work_order_start_datetime AT TIME ZONE 'America/Chicago')::date
        ) = p_date
    -- An appointment, if one exists, IS the schedule — branch (a) has it.
    AND NOT EXISTS (
      SELECT 1 FROM public.service_appointments sa2
      WHERE sa2.work_order_id = wo.id AND sa2.sa_is_deleted IS NOT TRUE
    )
    AND (
      wo.assigned_technician_id    = public.current_app_user_id()
      OR wo.project_site_lead_user_id = public.current_app_user_id()
      OR wo.project_coordinator_id = public.current_app_user_id()
      OR pr.project_coordinator_id = public.current_app_user_id()
    )

  ORDER BY 4 NULLS LAST, 8;
$function$;

-- Same grants as before: this is the technician's own schedule, RLS-bound by
-- current_app_user_id() inside the body.
REVOKE ALL ON FUNCTION public.my_service_appointments(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_service_appointments(date) TO authenticated;

-- ─── Prove it, rather than assume it ────────────────────────────────────────
-- The check that matters is the one that was failing: a work order assigned to
-- a technician, scheduled for a day, with NO appointment, must be on that
-- technician's list for that day — and must NOT be on anybody else's.
DO $do$
DECLARE
  v_wo        record;
  v_seen      integer;
  v_other     integer;
  v_dupes     integer;
BEGIN
  SELECT wo.id, wo.work_order_record_number,
         COALESCE(wo.work_order_scheduled_start_date,
                  (wo.work_order_start_datetime AT TIME ZONE 'America/Chicago')::date) AS d,
         wo.assigned_technician_id AS tech
    INTO v_wo
  FROM public.work_orders wo
  WHERE wo.work_order_is_deleted IS NOT TRUE
    AND wo.assigned_technician_id IS NOT NULL
    AND COALESCE(wo.work_order_scheduled_start_date,
                 (wo.work_order_start_datetime AT TIME ZONE 'America/Chicago')::date) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.service_appointments sa
                    WHERE sa.work_order_id = wo.id AND sa.sa_is_deleted IS NOT TRUE)
  LIMIT 1;

  IF v_wo.id IS NULL THEN
    RAISE NOTICE 'No appointment-less assigned work order to verify against; rule installed unverified.';
    RETURN;
  END IF;

  -- Evaluate branch (b)'s predicate for the assigned technician...
  SELECT count(*) INTO v_seen
  FROM public.work_orders wo
  WHERE wo.id = v_wo.id
    AND COALESCE(wo.work_order_scheduled_start_date,
                 (wo.work_order_start_datetime AT TIME ZONE 'America/Chicago')::date) = v_wo.d
    AND NOT EXISTS (SELECT 1 FROM public.service_appointments sa
                    WHERE sa.work_order_id = wo.id AND sa.sa_is_deleted IS NOT TRUE)
    AND wo.assigned_technician_id = v_wo.tech;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'Work order % is assigned and scheduled but does not match the direct-assignment rule', v_wo.work_order_record_number;
  END IF;

  -- ...and for somebody who is not on it at all.
  SELECT count(*) INTO v_other
  FROM public.work_orders wo
  WHERE wo.id = v_wo.id
    AND (wo.assigned_technician_id = '00000000-0000-0000-0000-000000000000'::uuid
      OR wo.project_site_lead_user_id = '00000000-0000-0000-0000-000000000000'::uuid
      OR wo.project_coordinator_id = '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_other <> 0 THEN
    RAISE EXCEPTION 'Direct-assignment rule leaks work order % to an unrelated user', v_wo.work_order_record_number;
  END IF;

  -- No work order may arrive twice: branch (b) is restricted to work orders
  -- with no appointment, so the two branches are disjoint by construction.
  SELECT count(*) INTO v_dupes
  FROM public.work_orders wo
  WHERE wo.work_order_is_deleted IS NOT TRUE
    AND EXISTS (SELECT 1 FROM public.service_appointments sa
                WHERE sa.work_order_id = wo.id AND sa.sa_is_deleted IS NOT TRUE)
    AND NOT EXISTS (SELECT 1 FROM public.service_appointments sa
                    WHERE sa.work_order_id = wo.id AND sa.sa_is_deleted IS NOT TRUE);
  IF v_dupes <> 0 THEN
    RAISE EXCEPTION 'The two branches are not disjoint';
  END IF;

  RAISE NOTICE 'Verified against %: assigned technician sees it, an unrelated user does not.',
    v_wo.work_order_record_number;
END
$do$;

NOTIFY pgrst, 'reload schema';
