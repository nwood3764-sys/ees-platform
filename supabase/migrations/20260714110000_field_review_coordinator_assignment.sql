-- =====================================================================
-- Acting Project Coordinator for field-created work orders
-- (Nicholas, 2026-07-14).
--
-- Brittin Wood is the only Project Coordinator right now AND must stay
-- Admin — admin access is hardwired to the user's single role
-- (`app_user_can` / `is_admin` short-circuit on role_name='Admin', and
-- RLS policies follow), so her role cannot be flipped to Project
-- Coordinator without stripping admin access. Routing instead resolves
-- through data (never hardcoded):
--   1. the first active user whose role IS 'Project Coordinator'
--      (automatic takeover the day a dedicated PC is hired), else
--   2. the acting coordinator designated in
--      `field_review_coordinator_assignments` (admin-manageable row;
--      seeded to Brittin Wood on prod as config data).
-- The Field Data Verification Review task now routes through this
-- resolver. (The seed user "Priya Nair" USR-00006 — never had a login —
-- was soft-deleted on prod in the same session.)
--
-- Applied to production 2026-07-14 via MCP; verified in a rolled-back
-- probe (resolver → Brittin Wood; review task + in-app notification to
-- her). Advisor delta: only the resolver's standard
-- authenticated-executable lint.
-- =====================================================================

CREATE TABLE public.field_review_coordinator_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_scope text NOT NULL,
  frc_coordinator_user_id uuid NOT NULL REFERENCES public.users(id),
  frc_is_active boolean NOT NULL DEFAULT true,
  frc_is_deleted boolean NOT NULL DEFAULT false,
  frc_deleted_at timestamptz,
  frc_deleted_by uuid REFERENCES public.users(id),
  frc_deletion_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id)
);

CREATE UNIQUE INDEX field_review_coordinator_assignments_scope_active_uq
  ON public.field_review_coordinator_assignments (frc_scope)
  WHERE frc_is_active AND NOT frc_is_deleted;

ALTER TABLE public.field_review_coordinator_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY frc_read_internal ON public.field_review_coordinator_assignments
  FOR SELECT TO authenticated USING (public.app_user_can('read', 'work_orders'));
CREATE POLICY frc_admin_insert ON public.field_review_coordinator_assignments
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY frc_admin_update ON public.field_review_coordinator_assignments
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TRIGGER trg_frc_block_hard_delete
  BEFORE DELETE ON public.field_review_coordinator_assignments
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();
CREATE TRIGGER trg_frc_updated_at
  BEFORE UPDATE ON public.field_review_coordinator_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Resolver: role holder first, designated acting coordinator second.
CREATE OR REPLACE FUNCTION public._resolve_field_review_coordinator()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_reviewer uuid;
BEGIN
  SELECT u.id INTO v_reviewer
  FROM public.users u JOIN public.roles r ON r.id = u.role_id
  WHERE r.role_name = 'Project Coordinator'
    AND u.user_is_active IS TRUE AND u.user_is_deleted IS NOT TRUE
  ORDER BY u.user_created_at LIMIT 1;

  IF v_reviewer IS NULL THEN
    SELECT a.frc_coordinator_user_id INTO v_reviewer
    FROM public.field_review_coordinator_assignments a
    JOIN public.users u ON u.id = a.frc_coordinator_user_id
    WHERE a.frc_scope = 'field_created_work_orders'
      AND a.frc_is_active AND NOT a.frc_is_deleted
      AND u.user_is_active IS TRUE AND u.user_is_deleted IS NOT TRUE
    LIMIT 1;
  END IF;

  RETURN v_reviewer;
END;
$function$;

REVOKE ALL ON FUNCTION public._resolve_field_review_coordinator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._resolve_field_review_coordinator() TO authenticated, service_role;

-- Field Data Verification Review now routes through the resolver.
CREATE OR REPLACE FUNCTION public._create_field_data_review_task(
  p_work_order_id uuid,
  p_wo_rn text,
  p_property_name text,
  p_actor uuid,
  p_created_list text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_reviewer uuid := public._resolve_field_review_coordinator();
  v_fallback boolean := false;
BEGIN
  IF v_reviewer IS NULL THEN
    v_reviewer := p_actor;
    v_fallback := true;
  END IF;

  INSERT INTO public.tasks (subject, description, status, priority, owner_id, created_by_id,
                            related_object, related_id, is_automated, automation_rule, due_date)
  VALUES (
    format('Field Data Verification Review — %s at %s', p_wo_rn, coalesce(p_property_name, 'property')),
    format('A technician created records in the field that need an accuracy review: %s. Verify the property, building, unit, and project are correct and consistent (naming conventions, right account, no duplicates). Open the work order: /work_orders/%s%s',
           p_created_list, p_work_order_id,
           CASE WHEN v_fallback THEN ' — NOTE: no Project Coordinator is configured (no user holds the role and no acting coordinator is designated), so this task fell back to the creating technician. Set one in LEAP Admin to route these reviews.' ELSE '' END),
    'Open', 'High', v_reviewer, p_actor,
    'work_orders', p_work_order_id, true, 'field_created_data_review',
    (now() AT TIME ZONE 'America/Chicago')::date
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._create_field_data_review_task(uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._create_field_data_review_task(uuid, text, text, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
