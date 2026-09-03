-- A technician's day is a list of WORK ORDERS. An appointment never gates one.
--
-- Nicholas, 2026-09-02: "The service appointment should not block a work order
-- from being shown on the technician. The date and time and the technician on
-- the work order should be the only thing that pushes it to their app. The
-- service appointments are just showing that we were there multiple days."
--
-- my_service_appointments was written FROM service_appointments, so the
-- appointment WAS the stop and the work order merely hung off it. Every fix
-- today tried to let a work order through that frame: first a second branch for
-- work orders with no appointment, then a rule that the appointment only counts
-- if it carries a date. Both were patches on the wrong shape, and each had its
-- own way of losing a job -- a bare appointment took WO-00244 off Roman's day,
-- and an appointment whose crew differed from the work order hid WO-00245 from
-- Logan, who is assigned it.
--
-- So the query is turned around. It selects work orders. A work order is on my
-- day when it NAMES ME and either
--   (a) its own scheduled date is that day, or
--   (b) a visit on that day records that we were there.
--
-- One row per work order per day, by construction -- there is no UNION to
-- de-duplicate and no NOT EXISTS to get wrong. The visit is joined LATERALLY
-- only to supply the time window and the appointment's identity; it can no
-- longer decide whether the job is shown.
--
-- The multi-day case falls out of (b): today's removal did not finish, so
-- tomorrow's visit puts the same work order on tomorrow's list while every step
-- and photo captured today stays on it.
--
-- The return signature is unchanged, so LEAP Pad needs no deploy to benefit.
-- sa_id and the sa_* columns are null on a day the work order is reached by its
-- own date, which the client already renders (it falls back to the work order
-- number and prints a missing time as an em dash).

CREATE OR REPLACE FUNCTION public.my_service_appointments(p_date date DEFAULT ((now() AT TIME ZONE 'America/Chicago'::text))::date)
 RETURNS TABLE(sa_id uuid, sa_record_number text, sa_status text, sa_scheduled_start_time timestamp with time zone, sa_scheduled_end_time timestamp with time zone, sa_duration_minutes numeric, work_order_id uuid, work_order_record_number text, work_order_name text, work_order_status text, work_type_name text, property_name text, property_address text, building text, unit text, customer_name text, my_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    -- Assigned when the job names me, or when a visit that day puts me on the
    -- crew. Anything else reaching this row is coordination.
    CASE
      WHEN wo.assigned_technician_id    = public.current_app_user_id()
        OR wo.project_site_lead_user_id = public.current_app_user_id()
        OR (sa.id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.service_appointment_assignments saa
               WHERE saa.service_appointment_id = sa.id
                 AND saa.saa_is_deleted IS NOT TRUE
                 AND saa.saa_user_id = public.current_app_user_id()))
      THEN 'Assigned'
      ELSE 'Coordinating'
    END
  FROM public.work_orders wo
  -- The visit on this day, when there is one. LEFT JOIN LATERAL, so it can
  -- supply a time window but can never remove the work order from the list.
  -- LIMIT 1 keeps one row per work order per day even if somebody books twice.
  LEFT JOIN LATERAL (
    SELECT sa2.*
      FROM public.service_appointments sa2
     WHERE sa2.work_order_id = wo.id
       AND sa2.sa_is_deleted IS NOT TRUE
       AND (sa2.sa_scheduled_start_time AT TIME ZONE 'America/Chicago')::date = p_date
     ORDER BY sa2.sa_scheduled_start_time
     LIMIT 1
  ) sa ON TRUE
  LEFT JOIN public.projects pr
    ON pr.id = wo.project_id AND pr.project_is_deleted IS NOT TRUE
  LEFT JOIN public.work_types wt ON wt.id = wo.work_type_id
  LEFT JOIN public.picklist_values sast ON sast.id = sa.sa_status
  LEFT JOIN public.picklist_values wost ON wost.id = wo.work_order_status
  LEFT JOIN public.properties p ON p.id = wo.property_id
  LEFT JOIN public.buildings  b ON b.id = wo.building_id
  LEFT JOIN public.units      u ON u.id = wo.unit_id
  WHERE wo.work_order_is_deleted IS NOT TRUE
    AND (
      COALESCE(
        wo.work_order_scheduled_start_date,
        (wo.work_order_start_datetime AT TIME ZONE 'America/Chicago')::date
      ) = p_date
      OR sa.id IS NOT NULL
    )
    AND (
      wo.assigned_technician_id       = public.current_app_user_id()
      OR wo.project_site_lead_user_id = public.current_app_user_id()
      OR wo.project_coordinator_id    = public.current_app_user_id()
      OR pr.project_coordinator_id    = public.current_app_user_id()
      OR (sa.id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.service_appointment_assignments saa
             WHERE saa.service_appointment_id = sa.id
               AND saa.saa_is_deleted IS NOT TRUE
               AND saa.saa_user_id = public.current_app_user_id()))
    )
  ORDER BY 4 NULLS LAST, 8;
$function$;

-- Assertions. The rule is "a work order with a date and a technician reaches
-- that technician", so what must be proved is that nothing can stand in its way.
DO $$
DECLARE
  v_src text; v_roman uuid; v_n int;
BEGIN
  v_src := pg_get_functiondef('public.my_service_appointments(date)'::regprocedure);

  IF position('FROM public.work_orders wo' IN v_src) = 0 THEN
    RAISE EXCEPTION 'the day is no longer selected from work orders';
  END IF;
  IF position('LEFT JOIN LATERAL' IN v_src) = 0 THEN
    RAISE EXCEPTION 'the visit is no longer joined laterally and could gate the work order again';
  END IF;
  -- The two shapes that previously let an appointment decide. A UNION
  -- reintroduces the duplicate risk; a NOT EXISTS reintroduces the stand-down.
  IF position('UNION ALL' IN v_src) > 0 THEN
    RAISE EXCEPTION 'the two-branch UNION is back; a work order can be listed twice or not at all';
  END IF;
  IF position('NOT EXISTS' IN v_src) > 0 THEN
    RAISE EXCEPTION 'an appointment can gate a work order again';
  END IF;

  SELECT id INTO v_roman FROM public.users
   WHERE user_first_name = 'Roman' AND user_last_name = 'Rufino' AND user_is_deleted IS NOT TRUE;

  SELECT count(*) INTO v_n
    FROM public.work_orders wo
   WHERE wo.work_order_is_deleted IS NOT TRUE
     AND wo.assigned_technician_id = v_roman
     AND wo.work_order_scheduled_start_date = DATE '2026-09-02';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'the reported case is gone from the data; verify by hand rather than trusting this migration';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.my_service_appointments(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_service_appointments(date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
