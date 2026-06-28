-- Drop v4 signature so v5 can be created with the new
-- p_inter_property_buffer_minutes parameter appended at the end.
-- (Postgres treats a signature change as a new function.)
DROP FUNCTION public.bulk_schedule_work_orders(
  uuid, uuid[], uuid, date, date,
  time without time zone, time without time zone,
  time without time zone, time without time zone,
  integer, text, boolean, jsonb
);
