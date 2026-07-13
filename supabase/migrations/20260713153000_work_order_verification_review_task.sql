-- =====================================================================
-- Verification review routing (Nicholas, 2026-07-13):
-- when a work order transitions to "To Be Verified", automatically
-- create a review task for its Project Coordinator (fallback: the work
-- order owner if no coordinator is set). The existing
-- trg_task_create_notification trigger then raises the coordinator's
-- in-app LEAP notification. IN-APP ONLY — no email anywhere in this
-- path, per standing rule.
--
-- Fires on every transition INTO To Be Verified, so a resubmission
-- after Corrections Needed produces a fresh review task.
--
-- Applied to production 2026-07-13 via MCP; verified in a rolled-back
-- probe (WO -> To Be Verified auto-created the coordinator's task and
-- in-app notification).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_work_order_review_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  s_to_be_verified uuid := '583c6ac2-7d3f-4c9e-81d7-3ceb66c6c0ca';  -- Work Order To Be Verified
  v_reviewer uuid;
  v_prop     text;
BEGIN
  IF NEW.work_order_is_deleted THEN RETURN NULL; END IF;
  IF NEW.work_order_status IS NOT DISTINCT FROM OLD.work_order_status THEN RETURN NULL; END IF;
  IF NEW.work_order_status IS DISTINCT FROM s_to_be_verified THEN RETURN NULL; END IF;

  -- Project Coordinator reviews; fall back to the work order owner so a
  -- submission is never silently unrouted.
  v_reviewer := COALESCE(NEW.project_coordinator_id, NEW.work_order_owner);
  IF v_reviewer IS NULL THEN RETURN NULL; END IF;

  SELECT p.property_name INTO v_prop FROM public.properties p WHERE p.id = NEW.property_id;

  INSERT INTO public.tasks (subject, description, status, priority, owner_id, created_by_id,
                            related_object, related_id, is_automated, automation_rule, due_date)
  VALUES (
    format('Review submitted work order %s — %s', NEW.work_order_record_number, NEW.work_order_name),
    format('%s was submitted for verification and is in To Be Verified at %s. Review the step evidence and verify or send back for corrections. Open the work order: /work_orders/%s',
           NEW.work_order_record_number, coalesce(v_prop, 'the property'), NEW.id),
    'Open', 'High', v_reviewer, NEW.work_order_updated_by,
    'work_orders', NEW.id, true, 'work_order_to_be_verified_review_task',
    (now() AT TIME ZONE 'America/Chicago')::date
  );

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_work_order_review_task() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order_review_task() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_work_orders_review_task ON public.work_orders;
CREATE TRIGGER trg_work_orders_review_task
  AFTER UPDATE OF work_order_status ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.create_work_order_review_task();

NOTIFY pgrst, 'reload schema';
