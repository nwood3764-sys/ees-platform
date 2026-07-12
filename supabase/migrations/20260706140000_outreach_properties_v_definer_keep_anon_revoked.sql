-- Restore outreach_properties_v to security_definer to fix the Enrollment /
-- Outreach Properties list statement-timeout introduced by 20260706120000.
--
-- 20260706120000 set security_invoker=on to close an unauthenticated leak. That
-- correctly closed it, but the Properties list loads all ~17.5k rows through
-- this 4-join view, and under security_invoker RLS is evaluated on the view AND
-- every joined table per statement — which exceeds the authenticated role's
-- statement_timeout (a prior perf migration had relied on the view bypassing
-- RLS). The page began returning "canceling statement due to statement timeout".
--
-- The actual unauthenticated leak stays CLOSED regardless of security mode:
-- anon has NO privileges on this view (revoked in 20260706120000, re-asserted
-- here) and cannot query it. security_definer only affects authenticated
-- callers, and today every authenticated user is internal staff with
-- properties-read permission, so the row set is identical either way.
--
-- FOLLOW-UP — blocker before any external/portal (non-staff) user goes live:
--   1. Move the Properties list to server-side pagination so a page reads ~50
--      rows, not all 17.5k, in one statement.
--   2. Then restore security_invoker=on so authenticated-but-unauthorized users
--      are properly row-filtered.
-- Doing (1) first keeps (2) from re-introducing the timeout.
--
-- NOTE: get_advisors(security) will again report security_definer_view for this
-- view — that is the deliberate, documented trade-off above, not a regression.
alter view public.outreach_properties_v set (security_invoker = false);
revoke all on public.outreach_properties_v from anon;
notify pgrst, 'reload schema';
