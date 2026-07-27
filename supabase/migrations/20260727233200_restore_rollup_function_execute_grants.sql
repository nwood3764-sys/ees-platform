-- Restore EXECUTE on the rollup functions to authenticated + service_role.
--
-- Regression: migration 20260727025442 (unit record types + dwelling-unit
-- rollups) did `REVOKE ALL ... FROM public, anon, authenticated` on
-- recompute_building_rollups / recompute_property_rollups /
-- recompute_account_rollups but never re-granted EXECUTE to authenticated —
-- unlike the same-day migration 20260727023127, which deliberately preserved
-- the ACL (GRANT EXECUTE TO authenticated, service_role).
--
-- These three functions are SECURITY DEFINER, but they are PERFORM'd from the
-- SECURITY INVOKER trigger functions trg_buildings_rollup, trg_units_rollup,
-- trg_properties_rollup, trg_projects_rollup, and trg_opportunities_rollup,
-- which run as the logged-in `authenticated` role. A function call from an
-- invoker context checks EXECUTE against that role, so with the grant missing
-- every INSERT/UPDATE/DELETE on buildings, units, properties, projects, and
-- opportunities failed with "permission denied for function
-- recompute_property_rollups" and rolled back. This restores the grant.

REVOKE ALL ON FUNCTION public.recompute_building_rollups(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recompute_property_rollups(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recompute_account_rollups(uuid)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.recompute_building_rollups(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_property_rollups(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_account_rollups(uuid)  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
