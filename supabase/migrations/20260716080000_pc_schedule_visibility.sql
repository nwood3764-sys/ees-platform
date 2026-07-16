-- =============================================================================
-- Project Coordinator schedule visibility (Nicholas, 2026-07-16).
--
-- my_service_appointments previously started FROM service_appointment_
-- assignments, so the schedule showed ONLY appointments where the signed-in
-- user is assigned crew. Project Coordinators need to see every scheduled
-- appointment on work orders / projects they coordinate — live, at every
-- work-order status, regardless of work-step completion — without being
-- crew on the stop.
--
-- Rebuilt to start FROM service_appointments with three visibility paths:
--   1. assigned crew  (a live service_appointment_assignments row for me)
--   2. work-order Project Coordinator (work_orders.project_coordinator_id)
--   3. project Project Coordinator    (projects.project_coordinator_id,
--      via the appointment's project or the work order's project)
--
-- New trailing column `my_role` ('Assigned' | 'Coordinating') tells LEAP Pad
-- why the stop is on your schedule; crew assignment wins when both apply.
-- Trailing-column addition keeps every existing consumer working, but the
-- OUT-parameter change forces DROP + CREATE, so grants are re-issued below.
-- =============================================================================

DROP FUNCTION IF EXISTS public.my_service_appointments(date);

CREATE FUNCTION public.my_service_appointments(
  p_date date DEFAULT ((now() AT TIME ZONE 'America/Chicago'::text))::date
)
RETURNS TABLE(
  sa_id uuid,
  sa_record_number text,
  sa_status text,
  sa_scheduled_start_time timestamp with time zone,
  sa_scheduled_end_time timestamp with time zone,
  sa_duration_minutes numeric,
  work_order_id uuid,
  work_order_record_number text,
  work_order_name text,
  work_order_status text,
  work_type_name text,
  property_name text,
  property_address text,
  building text,
  unit text,
  customer_name text,
  my_role text
)
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
  ORDER BY sa.sa_scheduled_start_time NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.my_service_appointments(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_service_appointments(date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
