-- Creating a building on a property failed with
--   "permission denied for function recompute_property_rollups"
-- and the record was rolled back. This is the SECOND occurrence of the identical
-- defect (first fixed 2026-07-27 by 20260727233200), so this migration fixes the
-- mechanism rather than the symptom.
--
-- Why it keeps happening
-- ---------------------
-- recompute_property_rollups / _building_ / _account_ / _opportunity_ are
-- SECURITY DEFINER, but they are PERFORM'd from five SECURITY *INVOKER* trigger
-- functions (trg_buildings_rollup, trg_units_rollup, trg_properties_rollup,
-- trg_projects_rollup, trg_opportunities_rollup) that run as the signed-in
-- `authenticated` role. A call made from an invoker context checks EXECUTE
-- against that role -- so the whole feature hung on an EXECUTE grant to
-- `authenticated`.
--
-- That grant is exactly what LEAP's advisor hygiene tells every migration to
-- take away: `authenticated_security_definer_function_executable`. So the two
-- rules were in direct conflict, and the tie broke a different way each time:
--   20260727025442 revoked it            -> every building/unit/property/project/
--                                           opportunity write failed.
--   20260727233200 granted it back       -> writes worked, 3 advisor lints.
--   20260829234151 revoked it again      -> building creation broken again (this
--                                           report). Verified live: of the four
--                                           rollup functions only
--                                           recompute_property_rollups had lost
--                                           the grant, which is why ONLY the
--                                           building/property path was failing.
-- Re-granting is the band-aid that has now failed twice. The next migration that
-- tidies an advisor lint would break record creation a third time.
--
-- The fix
-- -------
-- Make the five trigger functions SECURITY DEFINER, so the nested rollup call
-- runs as the owner and no EXECUTE grant to `authenticated` is needed by
-- anything. This is the pattern LEAP already settled on for geographic record
-- access (policies call the definer entry point record_in_state_scope(), so
-- EXECUTE stays revoked on all 110 generated resolvers).
--
-- Nothing is widened. The bodies are byte-identical apart from the security
-- clause, every one of them already carries a fixed
-- `SET search_path TO 'public','pg_catalog'`, and their entire body is a PERFORM
-- of a function that was ALREADY running as the owner. Effective privilege is
-- unchanged; only the EXECUTE check disappears. Trigger functions return
-- `trigger`, so PostgREST cannot call them and they add no callable surface.
--
-- Verified before writing this: the five trigger functions are the ONLY
-- SECURITY INVOKER callers of the rollup functions in the entire database (no
-- policy, no view, no client `.rpc()`, no edge function references them;
-- execute_flow's rollup branch is itself SECURITY DEFINER). So the grant can go
-- for good -- which also clears the 3 known advisor lints those grants carried
-- (222 -> 219), provided the promoted trigger functions are themselves revoked;
-- see step 2b, which is the part that is easy to miss.

-- ---------------------------------------------------------------------------
-- 1. The five rollup trigger functions run as owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_buildings_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_property_rollups(NEW.property_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_property_rollups(OLD.property_id);
  ELSE
    PERFORM recompute_property_rollups(NEW.property_id);
    IF OLD.property_id IS DISTINCT FROM NEW.property_id THEN
      PERFORM recompute_property_rollups(OLD.property_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_units_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_building_rollups(NEW.building_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_building_rollups(OLD.building_id);
  ELSE
    PERFORM recompute_building_rollups(NEW.building_id);
    IF OLD.building_id IS DISTINCT FROM NEW.building_id THEN
      PERFORM recompute_building_rollups(OLD.building_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_properties_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_account_rollups(NEW.property_account_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_account_rollups(OLD.property_account_id);
  ELSE
    PERFORM recompute_account_rollups(NEW.property_account_id);
    IF OLD.property_account_id IS DISTINCT FROM NEW.property_account_id THEN
      PERFORM recompute_account_rollups(OLD.property_account_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_projects_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_opportunity_rollups(NEW.opportunity_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_opportunity_rollups(OLD.opportunity_id);
  ELSE
    PERFORM recompute_opportunity_rollups(NEW.opportunity_id);
    IF OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
      PERFORM recompute_opportunity_rollups(OLD.opportunity_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_opportunities_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_account_rollups(NEW.opportunity_account_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_account_rollups(OLD.opportunity_account_id);
  ELSE
    PERFORM recompute_account_rollups(NEW.opportunity_account_id);
    IF OLD.opportunity_account_id IS DISTINCT FROM NEW.opportunity_account_id THEN
      PERFORM recompute_account_rollups(OLD.opportunity_account_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. No rollup function is callable by `authenticated` any more -- by anything.
--    Consistent across all four, and the three remaining advisor lints go with
--    it. `service_role` keeps EXECUTE for server-side maintenance.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.recompute_property_rollups(uuid)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_building_rollups(uuid)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_account_rollups(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_opportunity_rollups(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.recompute_property_rollups(uuid)    TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_building_rollups(uuid)    TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_account_rollups(uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_opportunity_rollups(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2b. ...and the trigger functions themselves are not callable by anyone.
--
--     A plain CREATE FUNCTION leaves the default PUBLIC EXECUTE grant in place,
--     so promoting these five to SECURITY DEFINER made each one a *callable*
--     definer function and the advisors flagged all five for both anon and
--     authenticated (222 -> 229, caught by re-running the advisors rather than
--     by assuming the count would fall). PostgreSQL does not check EXECUTE when
--     it FIRES a trigger -- only when the trigger is created -- so revoking it
--     costs nothing and closes the surface. Verified live after the revoke: a
--     building INSERT plus unit/property/opportunity UPDATEs as a signed-in
--     `authenticated` user all still succeed and still roll up.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.trg_buildings_rollup()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_units_rollup()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_properties_rollup()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_projects_rollup()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_opportunities_rollup() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The guard, so a third recurrence is loud instead of silent.
--
--    The defect class is general: ANY SECURITY INVOKER trigger function that
--    calls a SECURITY DEFINER function `authenticated` cannot execute will fail
--    every write to its table at runtime, and nothing in the build, the test
--    suite or the advisors reports it -- the advisors reward exactly the revoke
--    that causes it. This names the gap directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_trigger_function_privilege_gaps()
 RETURNS TABLE (
   table_name        text,
   trigger_name      text,
   trigger_function  text,
   called_function   text
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT DISTINCT
         c.relname::text,
         t.tgname::text,
         tf.proname::text,
         df.proname::text
  FROM pg_trigger t
  JOIN pg_class     c  ON c.oid = t.tgrelid
  JOIN pg_namespace cn ON cn.oid = c.relnamespace
  JOIN pg_proc      tf ON tf.oid = t.tgfoid
  JOIN pg_proc      df ON df.prosecdef
  JOIN pg_namespace dn ON dn.oid = df.pronamespace
  WHERE NOT t.tgisinternal
    AND cn.nspname = 'public'
    AND dn.nspname = 'public'
    AND NOT tf.prosecdef                                    -- invoker trigger fn
    AND tf.prosrc ~ ('\m' || df.proname || '\M')            -- calls a definer fn
    AND NOT has_function_privilege('authenticated', df.oid, 'EXECUTE')
  ORDER BY 1, 2, 3, 4;
$function$;

COMMENT ON FUNCTION public.find_trigger_function_privilege_gaps() IS
  'Lists SECURITY INVOKER trigger functions that call a SECURITY DEFINER function '
  '`authenticated` cannot EXECUTE. Every row is a table whose INSERT/UPDATE/DELETE '
  'fails for signed-in users with "permission denied for function ...". Must return '
  'zero rows. Fix a row by making the TRIGGER function SECURITY DEFINER (see '
  'migration 20260831021742) -- never by granting EXECUTE to authenticated, which '
  'the advisors then tell the next session to revoke.';

REVOKE ALL ON FUNCTION public.find_trigger_function_privilege_gaps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_trigger_function_privilege_gaps() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome. block_hard_delete() means a migration cannot prove
--    itself with a probe insert (the cleanup is refused and the whole migration
--    rolls back), so what is asserted here is the deployed state; the behavioural
--    proof is run separately in a rolled-back transaction.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad text; v_n int;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('trg_buildings_rollup','trg_units_rollup','trg_properties_rollup',
                      'trg_projects_rollup','trg_opportunities_rollup')
    AND (NOT p.prosecdef
         OR p.proconfig IS NULL
         OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'rollup trigger functions not SECURITY DEFINER with a fixed search_path: %', v_bad;
  END IF;

  SELECT string_agg(format('%s -> %s', trigger_function, called_function), '; ')
    INTO v_bad FROM public.find_trigger_function_privilege_gaps();
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invoker trigger functions still call un-executable definer functions: %', v_bad;
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('recompute_property_rollups','recompute_building_rollups',
                      'recompute_account_rollups','recompute_opportunity_rollups')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% rollup function(s) still executable by authenticated', v_n;
  END IF;

  -- No new advisor surface: the promoted trigger functions must be callable by
  -- neither anon nor authenticated.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('trg_buildings_rollup','trg_units_rollup','trg_properties_rollup',
                      'trg_projects_rollup','trg_opportunities_rollup')
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'rollup trigger function(s) still executable by anon/authenticated: %', v_bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
