-- Registering the vehicle route rebuilt the work_orders POLICY but not its
-- RESOLVER, and they are two different things:
--
--   the policy    decides who sees a work_orders ROW
--   the resolver  is what every object hanging off a work order calls to
--                 resolve ITS state -- work_steps, work_plans, photos,
--                 service_appointments, work_order_time_entries,
--                 vehicle_activities
--
-- So a state-restricted user could see a fleet work order and none of its
-- steps or photos. Caught by evaluating the resolver directly against real
-- data rather than trusting that installing the policy had covered it.
SELECT public.install_record_state_scope_resolver('work_orders');

DO $$
DECLARE v_src text; v_n int;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='record_state_scope_work_orders';
  IF v_src IS NULL THEN RAISE EXCEPTION 'The work_orders resolver is missing.'; END IF;
  IF v_src NOT LIKE '%record_state_scope_properties%' THEN
    RAISE EXCEPTION 'The resolver lost the property route — property work orders would stop being state-scoped.';
  END IF;
  IF v_src NOT LIKE '%vehicles%' THEN
    RAISE EXCEPTION 'The resolver does not carry the vehicle route — a fleet work order''s steps and photos would be invisible to a state-restricted user.';
  END IF;

  -- EXECUTE must stay revoked: the resolver runs nested inside the single
  -- granted entry point record_in_state_scope, and granting it would add an
  -- advisor finding for no benefit.
  IF has_function_privilege('authenticated',
       'public.record_state_scope_work_orders(uuid, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXECUTE on the work_orders resolver is granted to authenticated; it must stay revoked.';
  END IF;

  -- Non-NC property work orders must still be out of scope for an NC user.
  SELECT count(*) INTO v_n FROM public.work_orders wo
    JOIN public.properties p ON p.id = wo.property_id
   WHERE p.property_state <> 'NC' AND wo.work_order_is_deleted IS NOT TRUE
     AND public.record_state_scope_work_orders(wo.id, ARRAY['NC']);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% non-NC work order(s) resolve as in scope for an NC-only user.', v_n;
  END IF;
END $$;
