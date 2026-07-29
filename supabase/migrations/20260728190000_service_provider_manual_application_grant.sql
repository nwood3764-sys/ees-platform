-- ============================================================================
-- Allow internal staff to start an onboarding application manually.
-- create_service_provider_application() was service-role-only (anon intake
-- edge function). Grant it to authenticated so staff can start the process for
-- a provider they recruit via the "New Application" button in the Service
-- Providers module. It's SECURITY DEFINER and only creates records — the same
-- thing staff can already do on the object directly.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.create_service_provider_application(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
