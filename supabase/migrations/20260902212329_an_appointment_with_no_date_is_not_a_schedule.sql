-- An appointment that carries no date is not a schedule, and must not displace one.
--
-- Nicholas, 2026-09-02, after creating SA-00307 by hand on WO-00244:
--   "How do I schedule a service appointment? I need to get a date field in
--    here... I need to be able to get these work orders to the technicians."
--
-- Creating that appointment TOOK THE WORK ORDER OFF ROMAN'S DAY. Earlier the
-- same day my_service_appointments gained a second route in, so a work order
-- that names a technician and carries a date reaches them with no appointment
-- at all. Its stand-down condition was "this work order has an appointment" --
-- with no requirement that the appointment carry a schedule. So a bare
-- appointment satisfied it, branch (a) had no date to match on, and the stop
-- landed nowhere. Verified against prod before this ran: Roman's day returned
-- WO-00243 and WO-00245 and not WO-00244, which he is assigned and which is
-- dated today.
--
-- Two corrections, both narrow.
--
-- 1. The NOT EXISTS now requires the appointment to have a scheduled start.
--    Dedupe still holds BY CONSTRUCTION rather than by DISTINCT: branch (a)
--    can only return an appointment that has a start time on the date asked
--    for, and branch (b) now runs only when no appointment has one at all.
--    An appointment that moved the job to another date still wins -- the work
--    order stops showing on its own date, which is the point of booking one.
--
-- 2. An appointment is also mine when the WORK ORDER names me as its assigned
--    technician or project site lead, not only when a crew row names me.
--    This is not a widening: it is the same person branch (b) already put the
--    stop in front of before an appointment existed, so booking one can no
--    longer quietly take work away from the technician it is assigned to.
--    Live instance found while verifying: SA-00299 on WO-00245 lists Roman
--    Rufino as crew while the work order is assigned to LOGAN WOOD, so Logan
--    could not see his own job. He can now.
--
-- Blast radius measured on prod first: exactly ONE appointment carries no
-- schedule (SA-00307, the one in the report) and exactly ONE appointment names
-- a different person than its work order (SA-00299). Both are corrections.
--
-- The appointment-notification pipeline is untouched -- this is a read path.

CREATE OR REPLACE FUNCTION public.my_service_appointments(p_date date DEFAULT ((now() AT TIME ZONE 'America/Chicago'::text))::date)
 RETURNS TABLE(sa_id uuid, sa_record_number text, sa_status text, sa_scheduled_start_time timestamp with time zone, sa_scheduled_end_time timestamp with time zone, sa_duration_minutes numeric, work_order_id uuid, work_order_record_number text, work_order_name text, work_order_status text, work_type_name text, property_name text, property_address text, building text, unit text, customer_name text, my_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  -- (a) An appointment that carries a schedule, on this date.
  --
  -- It is mine when the appointment names me as crew, OR when the WORK ORDER
  -- names me as its assigned technician or project site lead. The second route
  -- is not a widening: it is the same person branch (b) already put the stop in
  -- front of before an appointment existed. Without it, booking an appointment
  -- and forgetting to add the crew row takes the job off the assigned
  -- technician's day -- which is exactly what happened to Logan Wood on
  -- WO-00245, whose appointment listed a different technician as crew.
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
      )
        OR wo.assigned_technician_id    = public.current_app_user_id()
        OR wo.project_site_lead_user_id = public.current_app_user_id()
      THEN 'Assigned'
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
      OR wo.assigned_technician_id    = public.current_app_user_id()
      OR wo.project_site_lead_user_id = public.current_app_user_id()
      OR wo.project_coordinator_id = public.current_app_user_id()
      OR pr.project_coordinator_id = public.current_app_user_id()
    )

  UNION ALL

  -- (b) A work order scheduled for this date that names me, with no appointment
  --     CARRYING A SCHEDULE to stand in for it.
  --
  -- The date condition on the NOT EXISTS is the whole point: an appointment
  -- with no start time is not a schedule, and must not displace one. Booking a
  -- bare appointment used to take the work order off its technician's day and
  -- put it nowhere -- branch (a) needs a date to match on, and branch (b) had
  -- already stood down (Nicholas, 2026-09-02: SA-00307 on WO-00244).
  --
  -- Dedupe stays by construction: branch (a) can only return an appointment
  -- that HAS a start time, and this branch only runs when none does.
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
    AND COALESCE(
          wo.work_order_scheduled_start_date,
          (wo.work_order_start_datetime AT TIME ZONE 'America/Chicago')::date
        ) = p_date
    AND NOT EXISTS (
      SELECT 1 FROM public.service_appointments sa2
      WHERE sa2.work_order_id = wo.id AND sa2.sa_is_deleted IS NOT TRUE
        AND sa2.sa_scheduled_start_time IS NOT NULL
    )
    AND (
      wo.assigned_technician_id    = public.current_app_user_id()
      OR wo.project_site_lead_user_id = public.current_app_user_id()
      OR wo.project_coordinator_id = public.current_app_user_id()
      OR pr.project_coordinator_id = public.current_app_user_id()
    )

  ORDER BY 4 NULLS LAST, 8;
$function$;

-- ── Assertions ───────────────────────────────────────────────────────────────
-- Both directions, because either one alone can be satisfied by a broken rule:
-- dropping the stand-down entirely would restore WO-00244 and also DOUBLE every
-- stop that legitimately has an appointment.
DO $$
DECLARE
  v_roman  uuid;
  v_logan  uuid;
  v_src    text;
  v_n      int;
BEGIN
  v_src := pg_get_functiondef('public.my_service_appointments(date)'::regprocedure);

  IF position('sa2.sa_scheduled_start_time IS NOT NULL' IN v_src) = 0 THEN
    RAISE EXCEPTION 'the stand-down no longer requires the appointment to carry a schedule';
  END IF;
  IF position('OR wo.assigned_technician_id    = public.current_app_user_id()' IN v_src) = 0 THEN
    RAISE EXCEPTION 'an appointment is no longer reachable by the work order''s own assignee';
  END IF;

  SELECT id INTO v_roman FROM public.users
   WHERE user_first_name = 'Roman' AND user_last_name = 'Rufino' AND user_is_deleted IS NOT TRUE;
  SELECT id INTO v_logan FROM public.users
   WHERE user_first_name = 'Logan' AND user_last_name = 'Wood' AND user_is_deleted IS NOT TRUE;

  -- The reported case: a work order the technician is assigned, dated today,
  -- whose only appointment carries no schedule, must still be on their day.
  SELECT count(*) INTO v_n
  FROM public.work_orders wo
  WHERE wo.work_order_is_deleted IS NOT TRUE
    AND wo.assigned_technician_id = v_roman
    AND wo.work_order_scheduled_start_date = DATE '2026-09-02'
    AND NOT EXISTS (SELECT 1 FROM public.service_appointments sa2
                     WHERE sa2.work_order_id = wo.id AND sa2.sa_is_deleted IS NOT TRUE
                       AND sa2.sa_scheduled_start_time IS NOT NULL);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'the reported case is gone from the data; re-verify the fix by hand rather than trusting this migration';
  END IF;

  -- And the appointment that names a different person than its work order is
  -- still there to be reached by the second correction.
  SELECT count(*) INTO v_n
  FROM public.service_appointments sa
  JOIN public.work_orders wo ON wo.id = sa.work_order_id AND wo.work_order_is_deleted IS NOT TRUE
  WHERE sa.sa_is_deleted IS NOT TRUE
    AND sa.sa_scheduled_start_time IS NOT NULL
    AND wo.assigned_technician_id = v_logan
    AND NOT EXISTS (SELECT 1 FROM public.service_appointment_assignments saa
                     WHERE saa.service_appointment_id = sa.id AND saa.saa_is_deleted IS NOT TRUE
                       AND saa.saa_user_id = v_logan);
  IF v_n < 1 THEN
    RAISE NOTICE 'no appointment now names a different person than its work order -- the second correction is inert here, which is fine';
  END IF;
END $$;

-- CREATE OR REPLACE keeps the existing ACL, so these restate the grants the
-- function already carried ({postgres,authenticated,service_role}) rather than
-- changing them -- and make it safe if this is ever reworked as DROP/CREATE.
REVOKE ALL ON FUNCTION public.my_service_appointments(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_service_appointments(date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
