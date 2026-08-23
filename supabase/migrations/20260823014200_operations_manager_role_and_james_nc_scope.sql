-- ============================================================================
-- Operations Manager role + James's user record, scoped to North Carolina
--
-- Nicholas, 2026-08-23: James is an operations manager — a role LEAP did not
-- have — and "he cannot see anything outside North Carolina at all for any
-- reason." The user record is created WITHOUT an auth link, so it cannot be
-- logged into: the invitation is deliberately not sent yet.
--
-- Object-level access mirrors Project Manager, the widest operational
-- non-Admin baseline (14 modules, 107 objects). The North Carolina restriction
-- is the separate record-level layer installed in the two migrations above.
-- ============================================================================

-- ─── The role ───────────────────────────────────────────────────────────────
INSERT INTO public.roles (role_name, role_description, role_is_active)
SELECT 'Operations Manager',
       'Runs day-to-day operations across the full project lifecycle. Object access mirrors Project Manager; record visibility is governed separately by the geographic scope granted to each user.',
       true
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE role_name = 'Operations Manager');

-- Object access copied from Project Manager rather than hand-listed, so the
-- two stay identical at creation and drift is a deliberate later edit.
INSERT INTO public.role_object_access
  (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT om.id, src.roa_object_name, src.roa_read, src.roa_create, src.roa_update, src.roa_delete
FROM public.role_object_access src
JOIN public.roles pm ON pm.id = src.roa_role_id AND pm.role_name = 'Project Manager'
CROSS JOIN public.roles om
WHERE om.role_name = 'Operations Manager'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access existing
    WHERE existing.roa_role_id = om.id AND existing.roa_object_name = src.roa_object_name
  );

INSERT INTO public.role_module_access (rma_role_id, rma_module_id, rma_can_access, is_deleted)
SELECT om.id, src.rma_module_id, src.rma_can_access, false
FROM public.role_module_access src
JOIN public.roles pm ON pm.id = src.rma_role_id AND pm.role_name = 'Project Manager'
CROSS JOIN public.roles om
WHERE om.role_name = 'Operations Manager'
  AND src.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM public.role_module_access existing
    WHERE existing.rma_role_id = om.id AND existing.rma_module_id = src.rma_module_id
  );

-- Operations Manager is office-side: work orders, dispatch and planning read
-- through app_is_office_side(), which is a fixed list rather than a lookup.
CREATE OR REPLACE FUNCTION public.app_is_office_side()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    public.app_current_role_name() IN (
      'Admin',
      'Program Manager',
      'Project Manager',
      'Project Coordinator',
      'Operations Manager',
      'Director of Field Services',
      'Project Site Lead'
    ),
    false
  );
$fn$;

REVOKE ALL ON FUNCTION public.app_is_office_side() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_is_office_side() TO authenticated;

-- ─── James's user record ────────────────────────────────────────────────────
-- No auth_user_id: the record exists so his access can be configured and
-- previewed, but there is nothing to log in with until the invitation is sent.
INSERT INTO public.users (user_first_name, user_last_name, user_title, role_id, user_is_active)
SELECT 'James', '', 'Operations Manager', r.id, false
FROM public.roles r
WHERE r.role_name = 'Operations Manager'
  AND NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_first_name = 'James' AND COALESCE(u.user_is_deleted, false) = false
  );

-- ─── His North Carolina grant ───────────────────────────────────────────────
INSERT INTO public.user_state_scopes (uss_user_id, uss_state_code, uss_notes)
SELECT u.id, 'NC',
       'North Carolina only. Nicholas, 2026-08-23: "He cannot see anything outside North Carolina at all for any reason."'
FROM public.users u
WHERE u.user_first_name = 'James'
  AND COALESCE(u.user_is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM public.user_state_scopes uss
    WHERE uss.uss_user_id = u.id AND uss.uss_state_code = 'NC' AND uss.uss_is_deleted = false
  );

NOTIFY pgrst, 'reload schema';
