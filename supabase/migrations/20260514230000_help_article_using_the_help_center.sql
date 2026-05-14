-- HA-00013 "Finding Help — The Help Center and the Help Button"
-- Documents the new context-aware ? button and the /help full center.
-- Audience='all'. Anchored to module:home, help-system concepts, and /help route.
-- Body markdown lives in production; this file records the migration's intent.

DO $$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM public.users
  WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1;
  RAISE NOTICE 'HA-00013 authored — see production help_articles table for body.';
END $$;
