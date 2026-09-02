-- ============================================================================
-- record_in_state_scope() was throwing for EVERY object, because one branch
-- pointed at a resolver that no longer exists.
--
--   select public.record_in_state_scope('work_orders', '<any uuid>');
--   ERROR 42883: function public.record_state_scope_incentives(uuid, text[])
--                does not exist
--   CONTEXT: SQL function "record_in_state_scope" during startup
--
-- Read that CONTEXT line carefully, because it is the whole lesson. The
-- dispatcher is LANGUAGE sql, and PostgreSQL parses a SQL function's ENTIRE
-- body on first call in a session. Every name in every branch has to resolve
-- before ANY branch runs. So a single dangling reference does not break
-- incentives — it breaks work orders, photos, properties, accounts and the
-- other 106 objects with it. A 110-way CASE is 110 chances to take the whole
-- thing down, and nothing was checking.
--
-- How it got there. `incentives` was registered in record_state_scope_sources
-- on 2026-08-23 (RSSS-00310/00311) and had a resolver generated for it. The
-- table has since gone; the resolver went with it; the dispatcher, which is
-- only rebuilt when the installer runs, kept naming it. The generator reads
-- pg_proc and so could never have EMITTED a phantom branch — it simply was
-- never re-run after the object disappeared. Nothing in the platform noticed:
-- the build is silent on database state, and the advisors do not check that a
-- function's body resolves.
--
-- What it cost, and what it did not. The state-scope policies short-circuit
-- when app_user_state_scope() is NULL, and it is NULL for everyone who has no
-- geographic grant — which is everyone except James (USR-00018, NC, granted
-- 2026-08-23). So this was masked platform-wide and live for exactly one user,
-- for whom every read and every write on a scoped object would have failed with
-- a Postgres error naming a function. He has no auth link and has never signed
-- in, which is the only reason it was not a production outage. It is fixed here
-- as the latent outage it is, not as the inconvenience it looked like.
--
-- This is NOT related to the photo-upload defect shipped alongside it.
--
-- Three parts:
--   1. Retire the registry rows for objects that no longer exist.
--   2. Rebuild the dispatcher, and make the rebuild PROVE the function it just
--      wrote actually runs, rather than merely that it compiled.
--   3. record_state_scope_integrity(), so a third occurrence is loud.
-- ============================================================================

-- ─── 1. Registry rows for objects that are gone ─────────────────────────────
-- Soft-deleted, never hard-deleted, and the reason says why — if `incentives`
-- comes back as a real table it is re-registered deliberately, not resurrected
-- by accident.
UPDATE public.record_state_scope_sources
   SET rsss_is_active      = false,
       rsss_is_deleted     = true,
       rsss_deleted_at     = now(),
       rsss_deletion_reason =
         'The object no longer exists in the database. Retired 2026-09-02: its '
         'stale resolver branch made record_in_state_scope() throw for every '
         'object, not only this one.'
 WHERE rsss_is_deleted = false
   AND to_regclass('public.' || quote_ident(rsss_object_name)) IS NULL;

-- ─── 2. The rebuild proves itself ───────────────────────────────────────────
-- Unchanged except for the self-test at the end. `check_function_bodies` does
-- not save us here (the installer deliberately turns it off, because resolvers
-- legitimately reference each other before they all exist), and a dispatcher
-- that compiles but cannot run is exactly the failure this is fixing. So the
-- rebuild now CALLS what it wrote. If the call raises, the rebuild raises, and
-- the migration or installer that triggered it fails loudly instead of leaving
-- a broken entry point behind.
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
  v_probe    boolean;
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

  -- PROVE IT RUNS. A SQL function is parsed whole on first call, so "created
  -- successfully" says nothing about whether any caller will get an answer. A
  -- non-null p_states is required to reach the CASE at all: with NULL states
  -- the body returns true before the branches are ever considered, which would
  -- make this probe pass on exactly the dispatcher that is broken.
  BEGIN
    SELECT public.record_in_state_scope(
             'work_orders', '00000000-0000-0000-0000-000000000000'::uuid,
             ARRAY['ZZ']::text[])
      INTO v_probe;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'record_in_state_scope was rebuilt over % resolvers but cannot be called: % (%). '
      'Every branch of a LANGUAGE sql dispatcher must resolve before any branch runs, '
      'so this breaks record access for EVERY object. Run '
      'select * from public.record_state_scope_integrity() to see what is dangling.',
      v_count, SQLERRM, SQLSTATE;
  END;

  RETURN format('dispatcher rebuilt over %s resolvers and verified callable', v_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rebuild_record_state_scope_dispatcher() FROM PUBLIC, anon, authenticated;

-- ─── 3. The guard ───────────────────────────────────────────────────────────
-- Nothing else catches this class. The build does not see the database, the
-- fixtures do not either, and the advisors check privileges and search paths —
-- not whether a function body resolves. This lists the two ways the state-scope
-- engine can be left pointing at something that is not there.
--
-- A registry row with NO resolver is deliberately NOT reported: an object with
-- no uuid `id` never gets one, and its policy resolves the predicate inline.
-- That is the designed shape for the HUD staging tables, and flagging it would
-- make the guard noise a person learns to ignore.
CREATE OR REPLACE FUNCTION public.record_state_scope_integrity()
RETURNS TABLE (problem text, object_name text, detail text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT 'registry row for an object that does not exist'::text,
         s.rsss_object_name::text,
         format('%s is registered (%s) but public.%I is not a table. '
                'Retire the row, then rebuild the dispatcher.',
                s.rsss_record_number, s.rsss_resolution_kind, s.rsss_object_name)
  FROM public.record_state_scope_sources s
  WHERE s.rsss_is_active AND NOT s.rsss_is_deleted
    AND to_regclass('public.' || quote_ident(s.rsss_object_name)) IS NULL

  UNION ALL

  -- The one that took the whole engine down. A dispatcher branch naming a
  -- resolver that is gone makes record_in_state_scope throw for EVERY object.
  SELECT 'dispatcher branch with no resolver'::text,
         b.obj::text,
         format('record_in_state_scope dispatches %L to '
                'public.record_state_scope_%s(uuid, text[]), which does not exist. '
                'This breaks record access for EVERY object, not just this one. '
                'Fix with: select public.rebuild_record_state_scope_dispatcher();',
                b.obj, b.obj)
  FROM (
    SELECT (regexp_matches(p.prosrc, 'WHEN ''([a-z_]+)'' THEN public\.record_state_scope_', 'g'))[1] AS obj
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_in_state_scope'
      AND pg_get_function_identity_arguments(p.oid) = 'p_object text, p_record_id uuid, p_states text[]'
  ) b
  WHERE to_regprocedure('public.record_state_scope_' || quote_ident(b.obj) || '(uuid,text[])') IS NULL

  ORDER BY 1, 2;
$fn$;

-- Internal, like every other function in this engine: policies reach the
-- scoping through record_in_state_scope, and nothing else needs to ask.
REVOKE ALL ON FUNCTION public.record_state_scope_integrity() FROM PUBLIC, anon, authenticated;

-- ─── Apply, then assert ─────────────────────────────────────────────────────
DO $do$
DECLARE
  v_result  text;
  v_left    integer;
  v_answer  boolean;
BEGIN
  v_result := public.rebuild_record_state_scope_dispatcher();
  RAISE NOTICE '%', v_result;

  SELECT count(*) INTO v_left FROM public.record_state_scope_integrity();
  IF v_left > 0 THEN
    RAISE EXCEPTION 'record_state_scope_integrity() still reports % problem(s) after the rebuild', v_left;
  END IF;

  -- The exact call from the bug report, on an object that has nothing to do
  -- with incentives — because that is what was failing.
  SELECT public.record_in_state_scope('work_orders',
           '00000000-0000-0000-0000-000000000000'::uuid, ARRAY['NC']::text[])
    INTO v_answer;
  IF v_answer IS NOT FALSE THEN
    RAISE EXCEPTION 'record_in_state_scope answered % for a non-existent work order; expected false', v_answer;
  END IF;

  -- And the two-argument policy form, which is what an actual RLS check calls.
  PERFORM public.record_in_state_scope('photos', '00000000-0000-0000-0000-000000000000'::uuid);
END
$do$;

NOTIFY pgrst, 'reload schema';
