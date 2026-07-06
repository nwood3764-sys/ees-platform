-- Tighten public.property_hud_match_review RLS.
--
-- The baseline shipped this HUD-matching review table with wide-open policies:
-- SELECT USING (true) and UPDATE USING (true) WITH CHECK (true) for the
-- `authenticated` role — i.e. any logged-in user could read or modify every
-- row. No application code (frontend, edge function, or DB RPC) reads or writes
-- this table; it is populated by an out-of-band service-role HUD process, and
-- the table is NOT force-RLS, so service_role/postgres bypass these policies
-- entirely. Scoping the client policies to admins therefore closes the
-- unrestricted-access hole with zero impact on the current data pipeline, and
-- leaves a sane default if a review UI is built later.

DROP POLICY IF EXISTS phmr_select_authenticated ON public.property_hud_match_review;
DROP POLICY IF EXISTS phmr_update_authenticated ON public.property_hud_match_review;

CREATE POLICY phmr_select_admin ON public.property_hud_match_review
  FOR SELECT TO authenticated
  USING (public.app_is_admin());

CREATE POLICY phmr_update_admin ON public.property_hud_match_review
  FOR UPDATE TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

NOTIFY pgrst, 'reload schema';
