-- ============================================================================
-- Geographic (state) record scoping — engine
--
-- LEAP has object-level security (role_object_access / permission sets, resolved
-- by app_user_can) but has never had record-level security for internal staff:
-- a role that can read `properties` reads every property in every state.
-- app_user_in_scope() exists but is wired to no policy and returns true for all
-- internal staff, so it has never restricted anything.
--
-- This installs the missing layer, on the geographic axis EES actually operates
-- on: a user granted one or more states sees ONLY records that positively
-- resolve to one of those states. A user with no grants is unrestricted, so
-- every existing user's access is byte-for-byte unchanged.
--
-- Three purpose-named artifacts:
--   user_state_scopes            — which states a user is granted (USS-)
--   record_state_scope_sources   — how each object resolves to a state (RSSS-)
--   install_record_state_scoping — generates that object's RESTRICTIVE policy
--
-- Enforcement is a RESTRICTIVE policy per object, ANDed with whatever policies
-- the object already has. A restrictive policy can only ever take access away,
-- so installing one cannot widen anyone's access by mistake.
-- ============================================================================

-- ─── Sequences ──────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.seq_user_state_scopes;
CREATE SEQUENCE IF NOT EXISTS public.seq_record_state_scope_sources;

-- ─── user_state_scopes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_state_scopes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uss_record_number    text NOT NULL DEFAULT '',
  uss_user_id          uuid NOT NULL REFERENCES public.users(id),
  uss_state_code       text NOT NULL,
  uss_notes            text,
  uss_owner            uuid REFERENCES public.users(id),
  uss_is_deleted       boolean NOT NULL DEFAULT false,
  uss_deleted_at       timestamptz,
  uss_deleted_by       uuid REFERENCES public.users(id),
  uss_deletion_reason  text,
  uss_created_at       timestamptz NOT NULL DEFAULT now(),
  uss_created_by       uuid REFERENCES public.users(id),
  uss_updated_at       timestamptz NOT NULL DEFAULT now(),
  uss_updated_by       uuid REFERENCES public.users(id),
  CONSTRAINT uss_state_code_is_two_letter CHECK (uss_state_code ~ '^[A-Z]{2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uss_user_state_active_unique
  ON public.user_state_scopes (uss_user_id, uss_state_code)
  WHERE uss_is_deleted = false;
CREATE INDEX IF NOT EXISTS uss_user_id_idx ON public.user_state_scopes (uss_user_id);

CREATE OR REPLACE FUNCTION public.set_user_state_scope_record_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.uss_record_number IS NULL OR NEW.uss_record_number = '' THEN
    NEW.uss_record_number := public.generate_record_number('USS-', 'public.seq_user_state_scopes');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uss_record_number ON public.user_state_scopes;
CREATE TRIGGER trg_uss_record_number BEFORE INSERT ON public.user_state_scopes
  FOR EACH ROW EXECUTE FUNCTION public.set_user_state_scope_record_number();

DROP TRIGGER IF EXISTS trg_uss_block_hard_delete ON public.user_state_scopes;
CREATE TRIGGER trg_uss_block_hard_delete BEFORE DELETE ON public.user_state_scopes
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- ─── record_state_scope_sources ─────────────────────────────────────────────
-- One row per resolution PATH. An object may declare several paths; the object
-- is in scope when ANY active path resolves into the user's granted states.
CREATE TABLE IF NOT EXISTS public.record_state_scope_sources (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rsss_record_number            text NOT NULL DEFAULT '',
  rsss_object_name              text NOT NULL,
  rsss_resolution_kind          text NOT NULL,
  rsss_state_column             text,
  rsss_parent_object_name       text,
  rsss_parent_fk_column         text,
  rsss_polymorphic_object_column text,
  rsss_polymorphic_record_id_column text,
  rsss_path_order               integer NOT NULL DEFAULT 1,
  rsss_notes                    text,
  rsss_is_active                boolean NOT NULL DEFAULT true,
  rsss_owner                    uuid REFERENCES public.users(id),
  rsss_is_deleted               boolean NOT NULL DEFAULT false,
  rsss_deleted_at               timestamptz,
  rsss_deleted_by               uuid REFERENCES public.users(id),
  rsss_deletion_reason          text,
  rsss_created_at               timestamptz NOT NULL DEFAULT now(),
  rsss_created_by               uuid REFERENCES public.users(id),
  rsss_updated_at               timestamptz NOT NULL DEFAULT now(),
  rsss_updated_by               uuid REFERENCES public.users(id),
  CONSTRAINT rsss_resolution_kind_known CHECK (rsss_resolution_kind IN (
    'own_state_column',       -- the object carries the state itself (properties)
    'parent_lookup',          -- FK to an object that resolves (buildings.property_id)
    'child_reverse_lookup',   -- in scope when a child row resolves (accounts <- properties)
    'polymorphic_lookup',     -- related_object / related_id pair (documents, tasks)
    'platform_configuration'  -- carries no customer data; never scoped
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS rsss_object_path_unique
  ON public.record_state_scope_sources (rsss_object_name, rsss_path_order)
  WHERE rsss_is_deleted = false;
CREATE INDEX IF NOT EXISTS rsss_object_name_idx ON public.record_state_scope_sources (rsss_object_name);

CREATE OR REPLACE FUNCTION public.set_record_state_scope_source_record_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rsss_record_number IS NULL OR NEW.rsss_record_number = '' THEN
    NEW.rsss_record_number := public.generate_record_number('RSSS-', 'public.seq_record_state_scope_sources');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rsss_record_number ON public.record_state_scope_sources;
CREATE TRIGGER trg_rsss_record_number BEFORE INSERT ON public.record_state_scope_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_record_state_scope_source_record_number();

DROP TRIGGER IF EXISTS trg_rsss_block_hard_delete ON public.record_state_scope_sources;
CREATE TRIGGER trg_rsss_block_hard_delete BEFORE DELETE ON public.record_state_scope_sources
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- ─── Compiled predicate cache ───────────────────────────────────────────────
-- Derived artifact, rewritten by install_record_state_scoping(). Holds the
-- parameterised form ($1 = granted states) so the polymorphic resolver does not
-- rebuild predicate SQL per row.
CREATE TABLE IF NOT EXISTS public.record_state_scope_compiled (
  rssc_object_name  text PRIMARY KEY,
  rssc_predicate    text NOT NULL,
  rssc_compiled_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Who is scoped, and to what ─────────────────────────────────────────────
-- Returns NULL when the caller is unrestricted (Admin, portal user, service
-- role, or an internal user with no grants). NULL is the fast path every
-- generated policy short-circuits on, so unscoped users pay ~nothing.
CREATE OR REPLACE FUNCTION public.app_user_state_scope()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN public.app_is_admin() THEN NULL::text[]
           ELSE NULLIF(
             ARRAY(
               SELECT DISTINCT upper(btrim(uss.uss_state_code))
               FROM public.user_state_scopes uss
               WHERE uss.uss_user_id = public.current_app_user_id()
                 AND uss.uss_is_deleted = false
               ORDER BY 1
             ),
             ARRAY[]::text[]
           )
         END;
$$;

CREATE OR REPLACE FUNCTION public.app_user_is_state_scoped()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.app_user_state_scope() IS NOT NULL;
$$;

-- ─── Predicate builder ──────────────────────────────────────────────────────
-- Compiles an object's registry rows into one boolean SQL expression evaluated
-- against `p_alias`. p_states_expr is the SQL text yielding the granted-state
-- array: 'public.app_user_state_scope()' for a policy, '$1' for the cache.
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
AS $$
DECLARE
  r            record;
  v_paths      text[] := ARRAY[]::text[];
  v_child      text;
  v_alias      text;
  v_any        boolean := false;
BEGIN
  -- Depth guard: the deepest real chain (photos -> work_steps -> work_plans ->
  -- work_orders -> properties) is 4 hops. 8 leaves headroom without allowing a
  -- misconfigured registry cycle to recurse forever.
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

    ELSIF r.rsss_resolution_kind = 'own_state_column' THEN
      v_paths := v_paths || format(
        'upper(btrim(%I.%I)) = ANY (%s)',
        p_alias, r.rsss_state_column, p_states_expr
      );

    ELSIF r.rsss_resolution_kind = 'parent_lookup' THEN
      v_alias := 's' || (p_depth + 1);
      v_child := public.build_record_state_scope_predicate(
        r.rsss_parent_object_name, v_alias, p_states_expr, p_depth + 1
      );
      v_paths := v_paths || format(
        'EXISTS (SELECT 1 FROM public.%I %I WHERE %I.id = %I.%I AND (%s))',
        r.rsss_parent_object_name, v_alias, v_alias, p_alias, r.rsss_parent_fk_column, v_child
      );

    ELSIF r.rsss_resolution_kind = 'child_reverse_lookup' THEN
      v_alias := 's' || (p_depth + 1);
      v_child := public.build_record_state_scope_predicate(
        r.rsss_parent_object_name, v_alias, p_states_expr, p_depth + 1
      );
      v_paths := v_paths || format(
        'EXISTS (SELECT 1 FROM public.%I %I WHERE %I.%I = %I.id AND (%s))',
        r.rsss_parent_object_name, v_alias, v_alias, r.rsss_parent_fk_column, p_alias, v_child
      );

    ELSIF r.rsss_resolution_kind = 'polymorphic_lookup' THEN
      v_paths := v_paths || format(
        'public.record_in_state_scope(%I.%I, %I.%I, %s)',
        p_alias, r.rsss_polymorphic_object_column,
        p_alias, r.rsss_polymorphic_record_id_column,
        p_states_expr
      );
    END IF;
  END LOOP;

  -- An object with no registry row is not yet taught. Fail CLOSED for a scoped
  -- user: a record that cannot be proved to be in their states is not theirs.
  IF NOT v_any THEN
    RETURN 'false';
  END IF;

  RETURN '(' || array_to_string(v_paths, ' OR ') || ')';
END;
$$;

-- ─── Polymorphic resolver ───────────────────────────────────────────────────
-- For documents / photos / tasks / activities / audit_log, which name their
-- parent in a text column. Reads the compiled cache rather than rebuilding SQL.
CREATE OR REPLACE FUNCTION public.record_in_state_scope(
  p_object    text,
  p_record_id uuid,
  p_states    text[]
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_predicate text;
  v_result    boolean;
BEGIN
  IF p_states IS NULL THEN
    RETURN true;                      -- caller is unrestricted
  END IF;
  IF p_object IS NULL OR p_record_id IS NULL THEN
    RETURN false;                     -- unattributable record: fail closed
  END IF;

  SELECT rssc_predicate INTO v_predicate
  FROM public.record_state_scope_compiled
  WHERE rssc_object_name = p_object;

  IF v_predicate IS NULL THEN
    RETURN false;                     -- object not taught: fail closed
  END IF;
  IF v_predicate = 'true' THEN
    RETURN true;                      -- platform configuration
  END IF;

  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM public.%I s0 WHERE s0.id = $2 AND (%s))',
    p_object, v_predicate
  ) INTO v_result USING p_states, p_record_id;

  RETURN COALESCE(v_result, false);
END;
$$;

-- ─── Installer ──────────────────────────────────────────────────────────────
-- Generates the object's RESTRICTIVE policy from the registry and refreshes its
-- compiled predicate. Idempotent; safe to re-run after any registry edit.
CREATE OR REPLACE FUNCTION public.install_record_state_scoping(p_object text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oid        oid;
  v_policy     text := 'state_scope_' || p_object;
  v_pred       text;
  v_param_pred text;
BEGIN
  SELECT c.oid INTO v_oid
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

  v_pred       := public.build_record_state_scope_predicate(p_object, p_object, 'public.app_user_state_scope()');
  v_param_pred := public.build_record_state_scope_predicate(p_object, 's0', '$1');

  INSERT INTO public.record_state_scope_compiled (rssc_object_name, rssc_predicate, rssc_compiled_at)
  VALUES (p_object, v_param_pred, now())
  ON CONFLICT (rssc_object_name)
  DO UPDATE SET rssc_predicate = EXCLUDED.rssc_predicate, rssc_compiled_at = now();

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, p_object);

  IF v_pred = 'true' THEN
    RETURN format('%s: platform configuration — never scoped', p_object);
  END IF;

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_object);

  -- RESTRICTIVE: ANDed with the object's existing policies, so this can only
  -- remove access, never grant it. The IS NULL arm is every unscoped user.
  EXECUTE format(
    'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO public
       USING (public.app_user_state_scope() IS NULL OR %s)
       WITH CHECK (public.app_user_state_scope() IS NULL OR %s)',
    v_policy, p_object, v_pred, v_pred
  );

  RETURN format('%s: state scoping installed', p_object);
END;
$$;

-- ─── Status / gap report ────────────────────────────────────────────────────
-- Every base table, whether it is registered, and whether its policy is live.
-- An unregistered table with customer data is a hole; this is how it is seen.
CREATE OR REPLACE FUNCTION public.record_state_scope_status()
RETURNS TABLE (
  object_name       text,
  resolution_kinds  text,
  policy_installed  boolean,
  row_estimate      bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.relname::text,
         COALESCE((
           SELECT string_agg(DISTINCT s.rsss_resolution_kind, ', ')
           FROM public.record_state_scope_sources s
           WHERE s.rsss_object_name = c.relname
             AND s.rsss_is_active = true AND s.rsss_is_deleted = false
         ), '(unregistered)'),
         EXISTS (
           SELECT 1 FROM pg_policy p
           WHERE p.polrelid = c.oid AND p.polname = 'state_scope_' || c.relname
         ),
         c.reltuples::bigint
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY 1;
$$;

-- ─── RLS on the new tables ──────────────────────────────────────────────────
ALTER TABLE public.user_state_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_state_scope_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_state_scope_compiled ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_select_user_state_scopes ON public.user_state_scopes;
CREATE POLICY app_select_user_state_scopes ON public.user_state_scopes FOR SELECT
  USING (public.app_is_admin() OR uss_user_id = public.current_app_user_id());
DROP POLICY IF EXISTS app_insert_user_state_scopes ON public.user_state_scopes;
CREATE POLICY app_insert_user_state_scopes ON public.user_state_scopes FOR INSERT
  WITH CHECK (public.app_is_admin());
DROP POLICY IF EXISTS app_update_user_state_scopes ON public.user_state_scopes;
CREATE POLICY app_update_user_state_scopes ON public.user_state_scopes FOR UPDATE
  USING (public.app_is_admin());
DROP POLICY IF EXISTS app_delete_user_state_scopes ON public.user_state_scopes;
CREATE POLICY app_delete_user_state_scopes ON public.user_state_scopes FOR DELETE
  USING (public.app_is_admin());

DROP POLICY IF EXISTS app_select_record_state_scope_sources ON public.record_state_scope_sources;
CREATE POLICY app_select_record_state_scope_sources ON public.record_state_scope_sources FOR SELECT
  USING (public.app_is_admin());
DROP POLICY IF EXISTS app_write_record_state_scope_sources ON public.record_state_scope_sources;
CREATE POLICY app_write_record_state_scope_sources ON public.record_state_scope_sources FOR ALL
  USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS app_select_record_state_scope_compiled ON public.record_state_scope_compiled;
CREATE POLICY app_select_record_state_scope_compiled ON public.record_state_scope_compiled FOR SELECT
  USING (public.app_is_admin());

-- ─── Grants ─────────────────────────────────────────────────────────────────
-- The resolvers are called from inside generated policies, so `authenticated`
-- must be able to execute them. The registry/installer are administration:
-- server-side only, never client-callable.
REVOKE ALL ON FUNCTION public.build_record_state_scope_predicate(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.install_record_state_scoping(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_user_state_scope_record_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_record_state_scope_source_record_number() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.app_user_state_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_user_state_scope() TO authenticated;
REVOKE ALL ON FUNCTION public.app_user_is_state_scoped() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_user_is_state_scoped() TO authenticated;
REVOKE ALL ON FUNCTION public.record_in_state_scope(text, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_in_state_scope(text, uuid, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.record_state_scope_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_state_scope_status() TO authenticated;

NOTIFY pgrst, 'reload schema';
