-- ============================================================================
-- Geographic (state) record scoping — static per-object resolvers
--
-- Resolving the chain inside one generic function fixed the recursion but made
-- a scoped user's queries unusable: plpgsql EXECUTE re-plans its SQL on every
-- call, so counting 7,536 accounts re-planned a nested EXISTS chain 7,536
-- times and the statement timed out.
--
-- Each object now gets its own generated resolver with a STATIC body:
--
--   record_state_scope_<object>(p_id uuid, p_states text[]) -> boolean
--
-- SECURITY DEFINER, so the whole chain runs with RLS off and no policy can
-- call back into another; LANGUAGE sql with a fixed body, so the plan is
-- prepared once and cached instead of rebuilt per row.
--
-- A parent hop is a call to the parent's resolver, so a work step reaching its
-- property costs three cached primary-key lookups. A policy never re-looks-up
-- its own row: it calls the PARENT's resolver with the foreign key it already
-- has, and an object carrying its own state column compares that column
-- directly with no call at all.
--
-- record_in_state_scope(object, id, states) — the polymorphic entry point used
-- by documents, photos, tasks, activities and audit_log — is regenerated as a
-- CASE over every resolver, so it too is static SQL rather than dynamic.
-- ============================================================================

DROP FUNCTION IF EXISTS public.record_in_state_scope(text, uuid, text[]) CASCADE;
DROP FUNCTION IF EXISTS public.record_in_state_scope(text, uuid) CASCADE;
DROP TABLE IF EXISTS public.record_state_scope_compiled;

-- ─── Predicate builder ──────────────────────────────────────────────────────
-- Emits a boolean SQL expression over `p_alias`. Parent hops become resolver
-- calls (definer, cached); own-state columns and the two join shapes that
-- cannot use a resolver stay inline.
CREATE OR REPLACE FUNCTION public.build_record_state_scope_predicate(
  p_object      text,
  p_alias       text,
  p_states_expr text DEFAULT 'public.app_user_state_scope()',
  p_depth       integer DEFAULT 0
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r            record;
  v_paths      text[] := ARRAY[]::text[];
  v_child      text;
  v_alias      text;
  v_any        boolean := false;
  v_parent_uid boolean;
BEGIN
  IF p_depth > 8 THEN
    RETURN 'false';
  END IF;

  FOR r IN
    SELECT *
    FROM public.record_state_scope_sources
    WHERE rsss_object_name = p_object
      AND rsss_is_active = true
      AND rsss_is_deleted = false
    ORDER BY rsss_path_order
  LOOP
    v_any := true;

    IF r.rsss_resolution_kind = 'platform_configuration' THEN
      RETURN 'true';

    ELSIF r.rsss_resolution_kind = 'hidden_when_scoped' THEN
      RETURN 'false';

    ELSIF r.rsss_resolution_kind = 'own_state_column' THEN
      v_paths := v_paths || format(
        'upper(btrim(%I.%I)) = ANY (%s)', p_alias, r.rsss_state_column, p_states_expr);

    ELSIF r.rsss_resolution_kind = 'parent_lookup' THEN
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = r.rsss_parent_object_name
          AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype AND a.attnum > 0
      ) INTO v_parent_uid;

      IF r.rsss_parent_key_column IS NULL AND v_parent_uid THEN
        -- The ordinary case: hand the foreign key straight to the parent's
        -- resolver. No self re-lookup, no table reference to recurse through.
        v_paths := v_paths || format(
          'public.record_state_scope_%s(%I.%I, %s)',
          r.rsss_parent_object_name, p_alias, r.rsss_parent_fk_column, p_states_expr);
      ELSE
        -- Joins on something other than the parent's id (the HUD identifier).
        -- Inline, and safe: the single hop lands on properties.
        v_alias := 's' || (p_depth + 1);
        v_child := public.build_record_state_scope_predicate(
          r.rsss_parent_object_name, v_alias, p_states_expr, p_depth + 1);
        v_paths := v_paths || format(
          'EXISTS (SELECT 1 FROM public.%I %I WHERE %I.%I = %I.%I AND (%s))',
          r.rsss_parent_object_name, v_alias,
          v_alias, COALESCE(r.rsss_parent_key_column, 'id'),
          p_alias, r.rsss_parent_fk_column, v_child);
      END IF;

    ELSIF r.rsss_resolution_kind = 'child_reverse_lookup' THEN
      v_alias := 's' || (p_depth + 1);
      v_child := public.build_record_state_scope_predicate(
        r.rsss_parent_object_name, v_alias, p_states_expr, p_depth + 1);
      v_paths := v_paths || format(
        'EXISTS (SELECT 1 FROM public.%I %I WHERE %I.%I = %I.%I AND (%s))',
        r.rsss_parent_object_name, v_alias,
        v_alias, r.rsss_parent_fk_column,
        p_alias, COALESCE(r.rsss_parent_key_column, 'id'), v_child);

    ELSIF r.rsss_resolution_kind = 'polymorphic_lookup' THEN
      v_paths := v_paths || format(
        'public.record_in_state_scope(%I.%I, %I.%I, %s)',
        p_alias, r.rsss_polymorphic_object_column,
        p_alias, r.rsss_polymorphic_record_id_column, p_states_expr);
    END IF;
  END LOOP;

  IF NOT v_any THEN
    RETURN 'false';
  END IF;

  RETURN '(' || array_to_string(v_paths, ' OR ') || ')';
END;
$fn$;

-- ─── Per-object resolver ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.install_record_state_scope_resolver(p_object text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_oid  oid;
  v_pred text;
  v_fn   text := 'record_state_scope_' || p_object;
BEGIN
  SELECT c.oid INTO v_oid
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = p_object AND c.relkind = 'r';
  IF v_oid IS NULL THEN
    RETURN format('%s: not a public base table — skipped', p_object);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = v_oid AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype AND a.attnum > 0
  ) THEN
    RETURN format('%s: no uuid id — no resolver (policy resolves inline)', p_object);
  END IF;

  v_pred := public.build_record_state_scope_predicate(p_object, 's0', 'p_states');

  -- Bodies are created with validation off because resolvers reference each
  -- other and the graph has no safe creation order.
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.%I(p_id uuid, p_states text[])
       RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path = public, pg_temp
     AS $body$
       SELECT CASE
                WHEN p_states IS NULL THEN true
                WHEN p_id IS NULL THEN false
                ELSE EXISTS (SELECT 1 FROM public.%I s0 WHERE s0.id = p_id AND (%s))
              END;
     $body$',
    v_fn, p_object, v_pred);

  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(uuid, text[]) FROM PUBLIC, anon', v_fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(uuid, text[]) TO authenticated', v_fn);

  RETURN format('%s: resolver installed', p_object);
END;
$fn$;

-- ─── Polymorphic dispatcher ─────────────────────────────────────────────────
-- A CASE over every resolver, so documents/photos/tasks/activities/audit_log
-- resolve through cached plans instead of dynamic SQL.
CREATE OR REPLACE FUNCTION public.rebuild_record_state_scope_dispatcher()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_branches text := '';
  v_count    integer := 0;
  r          record;
BEGIN
  FOR r IN
    SELECT p.proname::text AS fn, right(p.proname::text, -length('record_state_scope_')) AS obj
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'record\_state\_scope\_%'
      AND pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_states text[]'
    ORDER BY 1
  LOOP
    v_branches := v_branches || format(
      E'        WHEN %L THEN public.%I(p_record_id, p_states)\n', r.obj, r.fn);
    v_count := v_count + 1;
  END LOOP;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.record_in_state_scope(
       p_object text, p_record_id uuid, p_states text[])
       RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path = public, pg_temp
     AS $body$
       SELECT CASE
                WHEN p_states IS NULL THEN true
                WHEN p_object IS NULL OR p_record_id IS NULL THEN false
                ELSE (CASE p_object
%s
                        ELSE false
                      END)
              END;
     $body$', v_branches);

  -- The explicit-states form answers "is this record in THOSE states", which
  -- only the platform and an administrator previewing another user may ask.
  REVOKE ALL ON FUNCTION public.record_in_state_scope(text, uuid, text[]) FROM PUBLIC, anon, authenticated;

  RETURN format('dispatcher rebuilt over %s resolvers', v_count);
END;
$fn$;

-- ─── Policy installer ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.install_record_state_scoping(p_object text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_oid      oid;
  v_rls_on   boolean;
  v_policy   text := 'state_scope_' || p_object;
  v_baseline text := 'state_scope_baseline_' || p_object;
  v_pred     text;
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

  -- Built against the table itself, so a parent hop is one resolver call on a
  -- foreign key the row already carries.
  v_pred := public.build_record_state_scope_predicate(
    p_object, p_object, 'public.app_user_state_scope()');

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, p_object);

  IF v_pred = 'true' THEN
    RETURN format('%s: platform configuration — never scoped', p_object);
  END IF;

  IF NOT v_rls_on THEN
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true)',
      v_baseline, p_object);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_object);
  END IF;

  EXECUTE format(
    'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO public
       USING (public.app_user_state_scope() IS NULL OR %s)
       WITH CHECK (public.app_user_state_scope() IS NULL OR %s)',
    v_policy, p_object, v_pred, v_pred);

  RETURN format('%s: state scoping installed', p_object);
END;
$fn$;

REVOKE ALL ON FUNCTION public.build_record_state_scope_predicate(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.install_record_state_scope_resolver(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.install_record_state_scoping(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebuild_record_state_scope_dispatcher() FROM PUBLIC, anon, authenticated;

-- ─── Build resolvers, dispatcher, then policies ─────────────────────────────
DO $do$
DECLARE r record;
BEGIN
  SET LOCAL check_function_bodies = off;

  FOR r IN
    SELECT DISTINCT rsss_object_name FROM public.record_state_scope_sources
    WHERE rsss_is_active = true AND rsss_is_deleted = false
      AND rsss_resolution_kind <> 'platform_configuration'
    ORDER BY 1
  LOOP
    PERFORM public.install_record_state_scope_resolver(r.rsss_object_name);
  END LOOP;

  PERFORM public.rebuild_record_state_scope_dispatcher();

  FOR r IN
    SELECT DISTINCT rsss_object_name FROM public.record_state_scope_sources
    WHERE rsss_is_active = true AND rsss_is_deleted = false
    ORDER BY 1
  LOOP
    PERFORM public.install_record_state_scoping(r.rsss_object_name);
  END LOOP;
END
$do$;

NOTIFY pgrst, 'reload schema';
