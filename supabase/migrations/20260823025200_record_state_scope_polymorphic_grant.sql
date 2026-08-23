-- ============================================================================
-- Geographic (state) record scoping — polymorphic entry point at policy level
--
-- The polymorphic objects (documents, photos, tasks, activities, comments,
-- notifications, audit_log, field_history, envelopes, …) call the dispatcher
-- from inside their own policy, which runs as the querying user — and the
-- explicit-states form is deliberately not executable by `authenticated`,
-- because "is this record in THOSE states" is not a question a client may ask.
-- Reading documents therefore failed with "permission denied for function
-- record_in_state_scope".
--
-- The two-argument form is restored for exactly that use: it takes no states
-- from the caller, reading them from the caller's own grants instead, so it is
-- safe to grant and is what every generated policy now calls. The three-
-- argument form stays internal to the resolvers and to administrator preview.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_in_state_scope(p_object text, p_record_id uuid)
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

-- A policy asks about the caller's own scope, so it uses the two-argument
-- form; a resolver body already holds the states and uses the three.
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
    SELECT * FROM public.record_state_scope_sources
    WHERE rsss_object_name = p_object AND rsss_is_active = true AND rsss_is_deleted = false
    ORDER BY rsss_path_order
  LOOP
    v_any := true;

    IF r.rsss_resolution_kind = 'platform_configuration' THEN
      RETURN 'true';

    ELSIF r.rsss_resolution_kind = 'hidden_when_scoped' THEN
      RETURN 'false';

    ELSIF r.rsss_resolution_kind = 'own_state_column' THEN
      v_paths := v_paths || format('upper(btrim(%I.%I)) = ANY (%s)',
        p_alias, r.rsss_state_column, p_states_expr);

    ELSIF r.rsss_resolution_kind = 'parent_lookup' THEN
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = r.rsss_parent_object_name
          AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype AND a.attnum > 0
      ) INTO v_parent_uid;

      IF r.rsss_parent_key_column IS NULL AND v_parent_uid THEN
        v_paths := v_paths || format('public.record_state_scope_%s(%I.%I, %s)',
          r.rsss_parent_object_name, p_alias, r.rsss_parent_fk_column, p_states_expr);
      ELSE
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
      IF p_states_expr = 'public.app_user_state_scope()' THEN
        v_paths := v_paths || format('public.record_in_state_scope(%I.%I, %I.%I)',
          p_alias, r.rsss_polymorphic_object_column,
          p_alias, r.rsss_polymorphic_record_id_column);
      ELSE
        v_paths := v_paths || format('public.record_in_state_scope(%I.%I, %I.%I, %s)',
          p_alias, r.rsss_polymorphic_object_column,
          p_alias, r.rsss_polymorphic_record_id_column, p_states_expr);
      END IF;
    END IF;
  END LOOP;

  IF NOT v_any THEN
    RETURN 'false';
  END IF;

  RETURN '(' || array_to_string(v_paths, ' OR ') || ')';
END;
$fn$;

REVOKE ALL ON FUNCTION public.build_record_state_scope_predicate(text, text, text, integer) FROM PUBLIC, anon, authenticated;

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
