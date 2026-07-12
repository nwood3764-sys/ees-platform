-- Restore RLS enforcement on public.outreach_properties_v.
--
-- Root cause: the baseline (20260412000000) created this view WITH
-- (security_invoker=on) so it runs under the querying user's RLS. Two later
-- performance migrations recreated it with a bare `create or replace view ...
-- as ...` (20260701140000, 20260701150000). CREATE OR REPLACE VIEW without a
-- WITH clause RESETS the view's storage options, silently dropping
-- security_invoker. The view then executed as its owner (postgres) and, because
-- the base tables have RLS enabled but NOT forced, bypassed RLS entirely — and
-- the view still carried the default GRANT SELECT ... TO anon. Result: any
-- caller holding the public anon key could read every properties row
-- (owner names, HUD contact emails/phones, LIHTC financials) via PostgREST.
--
-- Fix (additive, non-breaking): re-assert security_invoker and remove anon
-- access. Authenticated users keep full access because the base-table SELECT
-- policies gate on app_user_can('properties','read') (a permission check, not
-- row ownership), so the app's Outreach/Enrollment lists are unaffected.
--
-- Dated after the two clobbering migrations so a full schema replay
-- (staging refresh) lands this last and the option sticks.

ALTER VIEW public.outreach_properties_v SET (security_invoker = on);

-- Defense in depth: the view is not an intended write or anonymous surface.
REVOKE ALL ON public.outreach_properties_v FROM anon;

NOTIFY pgrst, 'reload schema';
