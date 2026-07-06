-- Remove the client-facing EXECUTE grant on public.execute_flow.
--
-- execute_flow is a SECURITY DEFINER automation entrypoint. Its only legitimate
-- callers are other SECURITY DEFINER routines (trg_dispatch_record_create,
-- change_record_status, dispatch_date_based_flows, execute_flows_for), which
-- invoke it as their own definer and therefore do NOT need the caller to hold
-- EXECUTE. No frontend or edge-function path calls it directly. Leaving it
-- executable by anon/authenticated let any caller drive an arbitrary flow by
-- UUID with definer privileges. service_role (edge functions) keeps EXECUTE.

REVOKE EXECUTE ON FUNCTION public.execute_flow(uuid, text, uuid, text, text) FROM anon, authenticated, public;

NOTIFY pgrst, 'reload schema';
