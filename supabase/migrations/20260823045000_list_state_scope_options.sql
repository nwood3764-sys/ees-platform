-- ============================================================================
-- The states a grant can be made in, read from the data
--
-- LEAP hardcodes nothing, so the state list offered when granting a user
-- geographic access is derived from the states properties actually sit in,
-- with the record count behind each so an administrator can see what a grant
-- would open up. Soft-deleted properties are excluded from the count but the
-- state still appears if any property carries it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_state_scope_options()
RETURNS TABLE (state_code text, property_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT upper(btrim(p.property_state)) AS state_code,
         count(*) FILTER (WHERE COALESCE(p.property_is_deleted, false) = false) AS property_count
  FROM public.properties p
  WHERE p.property_state IS NOT NULL
    AND upper(btrim(p.property_state)) ~ '^[A-Z]{2}$'
  GROUP BY 1
  ORDER BY 2 DESC, 1;
$fn$;

REVOKE ALL ON FUNCTION public.list_state_scope_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_state_scope_options() TO authenticated;

NOTIFY pgrst, 'reload schema';
