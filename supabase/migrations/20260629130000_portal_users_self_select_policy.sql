-- =============================================================================
-- Project Portal — let a portal user read their own portal_users row
--
-- portal_users had only the internal-staff RLS policies (app_user_can(...)),
-- which evaluate against public.users / field-role permissions. A portal user
-- (external, authenticated via Supabase Auth, with NO public.users row) is not
-- covered by those, so the portal's fetchPortalUserSelf() — a direct, RLS-bound
-- SELECT on portal_users — returned nothing and the portal bounced straight back
-- to the login screen.
--
-- This adds a narrow, additive SELECT policy: an authenticated user may read the
-- single portal_users row linked to their own auth.uid(). It does not widen
-- staff access (permissive policies are OR-ed) and exposes only the caller's own
-- row. The project tracker itself stays behind the SECURITY DEFINER RPC.
-- =============================================================================

DROP POLICY IF EXISTS portal_user_self_select ON public.portal_users;

CREATE POLICY portal_user_self_select ON public.portal_users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid() AND is_deleted = false);

NOTIFY pgrst, 'reload schema';
