-- Routing fix: appointments_for_resource_in_window must return each existing
-- appointment's real service address so compute-availability can charge
-- inter-appointment drive time.
--
-- Root cause of "people can pick anytime regardless of location": the function
-- returned NULL for every address column, so compute-availability's drive-time
-- lookup had no appointment coordinates to route between. apptLabel() came back
-- empty, the drive matrix had nothing to compare, and the max-one-way-drive cap
-- was effectively disabled for every leg except home-base → customer. An auditor
-- already booked two hours away would still be offered a slot 15 minutes later.
--
-- The self-scheduler cascade links a service appointment to its property through
-- the WORK ORDER (service_appointments.work_order_id → work_orders.property_id),
-- leaving sa.project_id null. Older/admin-created rows may instead carry
-- sa.project_id → projects.property_id. Resolve the property from the work order
-- first, then fall back to the project, then to the SA's own project link.
-- Signature and return shape are unchanged, so compute-availability needs no
-- code change to benefit.

CREATE OR REPLACE FUNCTION public.appointments_for_resource_in_window(
  p_contact_id uuid,
  p_window_start timestamp with time zone,
  p_window_end timestamp with time zone
)
RETURNS TABLE(
  start_iso text,
  end_iso text,
  address_street text,
  address_city text,
  address_state text,
  address_zip text
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT sa.sa_scheduled_start_time::text AS start_iso,
         sa.sa_scheduled_end_time::text   AS end_iso,
         p.property_street AS address_street,
         p.property_city   AS address_city,
         p.property_state  AS address_state,
         p.property_zip    AS address_zip
  FROM service_appointments sa
  JOIN service_appointment_assignments saa
       ON saa.service_appointment_id = sa.id
      AND saa.contact_id              = p_contact_id
      AND saa.saa_is_deleted          = false
  LEFT JOIN work_orders wo ON wo.id = sa.work_order_id AND wo.work_order_is_deleted = false
  LEFT JOIN projects proj  ON proj.id = sa.project_id AND proj.project_is_deleted = false
  LEFT JOIN properties p
       ON p.id = COALESCE(wo.property_id, proj.property_id)
      AND p.property_is_deleted = false
  LEFT JOIN picklist_values pv ON pv.id = sa.sa_status
  WHERE sa.sa_is_deleted = false
    AND sa.sa_scheduled_start_time IS NOT NULL
    AND sa.sa_scheduled_end_time   IS NOT NULL
    AND sa.sa_scheduled_start_time <  p_window_end
    AND sa.sa_scheduled_end_time   >  p_window_start
    AND (pv.picklist_value IS NULL OR pv.picklist_value NOT IN ('canceled','no_show'))
  ORDER BY sa.sa_scheduled_start_time;
$function$;

NOTIFY pgrst, 'reload schema';
