-- Help articles for the Project Reports feature.
-- HA-00009 Generating a Project Report (all audience)
-- HA-00010 Authoring a Project Report Template (admin audience)
-- HA-00011 Publishing, Versioning, and Locking Templates (admin audience)
-- HA-00012 Photo Variants — Watermarked vs Original (all audience)
-- Full body markdown lives in production help_articles table; this file
-- is the version-controlled record of the migration's intent.

DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM public.users
  WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1;

  -- See production migration history (file 20260514220000) for full content.
  RAISE NOTICE 'help articles HA-00009..HA-00012 authored — see production help_articles table for body markdown.';
END $$;
