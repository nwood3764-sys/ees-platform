-- clone_work_plan_template() is not client-callable.
--
-- 20260822214901 granted it to service_role and revoked it from public and anon,
-- but the advisor still reported it executable by `authenticated`: this project
-- carries a blanket EXECUTE grant to that role, which a REVOKE FROM PUBLIC does
-- not cover. Nothing in the client calls this — it is a migration and Setup
-- facility — so the grant is removed outright, the same fix applied to the two
-- assessment trigger functions in 20260822213815.
--
-- Advisors return to 220: baseline 219 plus the one expected lint for
-- eligible_record_types_for_parent, which the record type picker really does call.

REVOKE ALL ON FUNCTION public.clone_work_plan_template(uuid, text, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_work_plan_template(uuid, text, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
