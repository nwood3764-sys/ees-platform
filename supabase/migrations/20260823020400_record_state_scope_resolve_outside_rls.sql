-- ============================================================================
-- Geographic (state) record scoping — resolve the predicate outside RLS
--
-- The first install put the join chain inline in each object's policy. That
-- recurses: work_orders' existing wo_select policy reads service_appointments,
-- and service_appointments' new state policy reads work_orders, so counting
-- work orders raised "infinite recursion detected in policy for relation
-- work_orders". Any inline reference to another scoped table is exposed to
-- that table's own policies, so the chain has to be evaluated somewhere RLS
-- does not apply.
--
-- It now resolves inside record_in_state_scope(), which is SECURITY DEFINER:
-- the whole chain — including nested polymorphic hops — runs with RLS off, so
-- no policy can call back into another. Each object's policy is one function
-- call against its own id.
--
-- Two exceptions stay inline, because inline is materially faster and neither
-- can recurse:
--   * an object that carries its own state column (properties, and the staging
--     tables) needs no join at all;
--   * the HUD staging tables have no id column to pass, and their single hop
--     lands on properties, whose policies reference no other table.
-- ============================================================================

-- ─── Policy-facing resolver ─────────────────────────────────────────────────
-- Two-argument form: the states are read from the caller's own grants and are
-- never supplied by the client, so this is what policies call and what
-- `authenticated` may execute. The three-argument form stays internal.
CREATE OR REPLACE FUNCTION public.record_in_state_scope(
  p_object    text,
  p_record_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.record_in_state_scope(p_object, p_record_id, public.app_user_state_scope());
$fn$;

REVOKE ALL ON FUNCTION public.record_in_state_scope(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_in_state_scope(text, uuid) TO authenticated;

-- The explicit-states form answers "is this record in THOSE states", which is
-- a question only the platform and an administrator previewing another user's
-- access may ask. Policies use the two-argument form above instead.
REVOKE ALL ON FUNCTION public.record_in_state_scope(text, uuid, text[]) FROM PUBLIC, anon, authenticated;

-- ─── Installer ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.install_record_state_scoping(p_object text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_oid         oid;
  v_rls_on      boolean;
  v_policy      text := 'state_scope_' || p_object;
  v_baseline    text := 'state_scope_baseline_' || p_object;
  v_param_pred  text;
  v_policy_pred text;
  v_has_uuid_id boolean;
  v_all_inline  boolean;
BEGIN
  SELECT c.oid, c.relrowsecurity INTO v_oid, v_rls_on
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = p_object AND c.relkind = 'r';

  IF v_oid IS NULL THEN
    RETURN format('%s: not a public base table — skipped', p_object);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.record_state_scope_sources
    WHERE rsss_object_name = p_object AND rsss_is_active = true AND rsss_is_deleted = false
  ) THEN
    RETURN format('%s: no registry row — skipped', p_object);
  END IF;

  -- The parameterised chain, evaluated inside the definer resolver.
  v_param_pred := public.build_record_state_scope_predicate(p_object, 's0', '$1');

  INSERT INTO public.record_state_scope_compiled (rssc_object_name, rssc_predicate, rssc_compiled_at)
  VALUES (p_object, v_param_pred, now())
  ON CONFLICT (rssc_object_name)
  DO UPDATE SET rssc_predicate = EXCLUDED.rssc_predicate, rssc_compiled_at = now();

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, p_object);

  IF v_param_pred = 'true' THEN
    RETURN format('%s: platform configuration — never scoped', p_object);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = v_oid AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype AND a.attnum > 0
  ) INTO v_has_uuid_id;

  SELECT bool_and(rsss_resolution_kind IN ('own_state_column', 'parent_lookup', 'hidden_when_scoped'))
    INTO v_all_inline
  FROM public.record_state_scope_sources
  WHERE rsss_object_name = p_object AND rsss_is_active = true AND rsss_is_deleted = false;

  IF v_param_pred = 'false' THEN
    -- hidden_when_scoped: no join, nothing to recurse into.
    v_policy_pred := 'false';
  ELSIF NOT v_has_uuid_id AND COALESCE(v_all_inline, false) THEN
    -- No id to hand the resolver; safe inline (single hop onto properties).
    v_policy_pred := public.build_record_state_scope_predicate(
      p_object, p_object, 'public.app_user_state_scope()');
  ELSIF EXISTS (
    SELECT 1 FROM public.record_state_scope_sources
    WHERE rsss_object_name = p_object AND rsss_is_active = true AND rsss_is_deleted = false
      AND rsss_resolution_kind <> 'own_state_column'
  ) THEN
    -- Anything that joins resolves in the definer resolver, never inline.
    v_policy_pred := format('public.record_in_state_scope(%L, %I.id)', p_object, p_object);
  ELSE
    -- Pure own-state-column object: the fast path, no join to expose.
    v_policy_pred := public.build_record_state_scope_predicate(
      p_object, p_object, 'public.app_user_state_scope()');
  END IF;

  IF NOT v_rls_on THEN
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true)',
      v_baseline, p_object
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_object);
  END IF;

  EXECUTE format(
    'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO public
       USING (public.app_user_state_scope() IS NULL OR %s)
       WITH CHECK (public.app_user_state_scope() IS NULL OR %s)',
    v_policy, p_object, v_policy_pred, v_policy_pred
  );

  RETURN format('%s: state scoping installed', p_object);
END;
$fn$;

REVOKE ALL ON FUNCTION public.install_record_state_scoping(text) FROM PUBLIC, anon, authenticated;

-- ─── Reinstall every object on the new shape ────────────────────────────────
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT rsss_object_name
    FROM public.record_state_scope_sources
    WHERE rsss_is_active = true AND rsss_is_deleted = false
    ORDER BY 1
  LOOP
    PERFORM public.install_record_state_scoping(r.rsss_object_name);
  END LOOP;
END
$do$;

NOTIFY pgrst, 'reload schema';
