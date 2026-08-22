-- The audit-column resolver and its two helpers are platform plumbing: they are
-- called by install_record_audit_stamping() and by the layout migrations, never
-- by the app. New functions are EXECUTE-able by PUBLIC by default, which would
-- let any holder of the anon key enumerate a table's columns through them.
-- Revoke, matching how every other non-client RPC in LEAP is granted.
REVOKE ALL ON FUNCTION public.resolve_record_audit_columns(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_page_objects()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._first_existing_column(oid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_record_audit_columns(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_page_objects()             TO service_role;
GRANT EXECUTE ON FUNCTION public._first_existing_column(oid, text[], text) TO service_role;

NOTIFY pgrst, 'reload schema';
