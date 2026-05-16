-- The v3 engine adds a new optional jsonb param; Postgres treats the new
-- signature as a separate function. Drop v2 first to avoid name ambiguity.
DROP FUNCTION IF EXISTS public.bulk_schedule_work_orders(
  uuid, uuid[], uuid, date, date,
  time without time zone, time without time zone,
  time without time zone, time without time zone,
  integer, text, boolean
);
