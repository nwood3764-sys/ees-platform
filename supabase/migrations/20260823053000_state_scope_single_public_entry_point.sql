-- ============================================================================
-- Geographic (state) record scoping — one public entry point, not 110
--
-- Generating a resolver per object and granting each to `authenticated` so the
-- policies could call them added about 105 new
-- authenticated_security_definer_function_executable advisor findings — one per
-- resolver — and, more to the point, published 110 SECURITY DEFINER functions
-- on the REST surface that no client has any business calling.
--
-- The resolvers do not need to be callable by the querying user. A policy can
-- go through record_in_state_scope(object, id), which is already SECURITY
-- DEFINER: the nested resolver call inside it runs as the function owner, so
-- the chain resolves exactly as before while EXECUTE stays revoked on every
-- generated resolver. Resolver bodies keep calling each other directly, since
-- they already run as the owner.
--
-- The result is one public entry point instead of 110, with no change to what
-- any user can see.
--
-- Also fixes the two function_search_path_mutable findings on the record-number
-- triggers added with this feature.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.build_record_state_scope_predicate(
  p_object      text,
  p_alias       text,
  p_states_expr text DEFAULT '(SELECT public.app_user_state_scope())::text[]',
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
  v_in_resolver boolean := (p_states_expr = 'p_states');
  v_own_scope   boolean := (p_states_expr = '(SELECT public.app_user_state_scope())::text[]');
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
        IF v_in_resolver THEN
          -- Already running as the owner: call the parent's resolver directly.
          v_paths := v_paths || format('public.record_state_scope_%s(%I.%I, p_states)',
            r.rsss_parent_object_name, p_alias, r.rsss_parent_fk_column);
        ELSIF v_own_scope THEN
          -- Policy expression: go through the single granted entry point.
          v_paths := v_paths || format('public.record_in_state_scope(%L, %I.%I)',
            r.rsss_parent_object_name, p_alias, r.rsss_parent_fk_column);
        ELSE
          -- An explicit state list (the administrator preview).
          v_paths := v_paths || format('public.record_in_state_scope(%L, %I.%I, %s)',
            r.rsss_parent_object_name, p_alias, r.rsss_parent_fk_column, p_states_expr);
        END IF;
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
      IF v_own_scope THEN
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

-- Resolvers are internal from here on: created without a grant to
-- `authenticated`, and any grant an earlier install left behind is revoked.
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

  EXECUTE format(
    'REVOKE ALL ON FUNCTION public.%I(uuid, text[]) FROM PUBLIC, anon, authenticated', v_fn);

  RETURN format('%s: resolver installed', p_object);
END;
$fn$;

REVOKE ALL ON FUNCTION public.build_record_state_scope_predicate(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.install_record_state_scope_resolver(text) FROM PUBLIC, anon, authenticated;

-- Both record-number triggers were created without a fixed search_path.
CREATE OR REPLACE FUNCTION public.set_user_state_scope_record_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.uss_record_number IS NULL OR NEW.uss_record_number = '' THEN
    NEW.uss_record_number := public.generate_record_number('USS-', 'public.seq_user_state_scopes');
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_record_state_scope_source_record_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.rsss_record_number IS NULL OR NEW.rsss_record_number = '' THEN
    NEW.rsss_record_number := public.generate_record_number('RSSS-', 'public.seq_record_state_scope_sources');
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_user_state_scope_record_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_record_state_scope_source_record_number() FROM PUBLIC, anon, authenticated;

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
