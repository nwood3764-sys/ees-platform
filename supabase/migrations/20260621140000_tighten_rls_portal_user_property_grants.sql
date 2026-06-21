-- Tighten RLS on portal_user_property_grants (was USING true / WITH CHECK true).
-- Internal-staff path mirrors portal_users exactly: app_user_can() RBAC, with
-- Admin always winning. Portal users never read this table directly (the portal
-- reads grants through SECURITY DEFINER get_portal_project_tracker), so the only
-- portal-user policy is a defense-in-depth, own-rows-only SELECT.
-- Applied via MCP 2026-06-21. No red/amber colors involved (DB-only change).

DROP POLICY IF EXISTS authenticated_read   ON public.portal_user_property_grants;
DROP POLICY IF EXISTS authenticated_insert ON public.portal_user_property_grants;
DROP POLICY IF EXISTS authenticated_update ON public.portal_user_property_grants;
DROP POLICY IF EXISTS authenticated_delete ON public.portal_user_property_grants;

-- Internal staff (Anura Admin) — RBAC-gated, identical pattern to portal_users
CREATE POLICY app_select_pug ON public.portal_user_property_grants
  FOR SELECT
  USING ((SELECT app_user_can('portal_user_property_grants','read')));

CREATE POLICY app_insert_pug ON public.portal_user_property_grants
  FOR INSERT
  WITH CHECK ((SELECT app_user_can('portal_user_property_grants','create')));

CREATE POLICY app_update_pug ON public.portal_user_property_grants
  FOR UPDATE
  USING ((SELECT app_user_can('portal_user_property_grants','update')))
  WITH CHECK ((SELECT app_user_can('portal_user_property_grants','update')));

CREATE POLICY app_delete_pug ON public.portal_user_property_grants
  FOR DELETE
  USING ((SELECT app_user_can('portal_user_property_grants','delete')));

-- Defense-in-depth: a portal user may read ONLY their own, non-deleted grants.
-- This grants the portal no new capability (it reads via RPC) but confines a
-- portal user to their own rows if they ever obtain a direct PostgREST handle.
CREATE POLICY portal_user_own_grants_select ON public.portal_user_property_grants
  FOR SELECT
  USING (
    pug_is_deleted = false
    AND EXISTS (
      SELECT 1 FROM public.portal_users pu
      WHERE pu.id = portal_user_property_grants.pug_portal_user_id
        AND pu.auth_user_id = auth.uid()
        AND pu.is_deleted = false
    )
  );

NOTIFY pgrst, 'reload schema';
