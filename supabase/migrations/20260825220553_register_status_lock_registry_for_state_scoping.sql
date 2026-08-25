-- Register the new registry with geographic record access.
--
-- record_state_scope_status() reports zero unregistered tables by design (the
-- 2026-08-23 rule), and a new table quietly appearing as "(unregistered)" is
-- exactly the drift that check exists to catch. record_status_lock_sources is
-- platform configuration -- it names which column carries each object's status,
-- the same in every state -- so it is registered as such and carries no
-- state-scoping policy, alongside record_audit_column_overrides.
INSERT INTO public.record_state_scope_sources (
  rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_notes
)
SELECT '', 'record_status_lock_sources', 'platform_configuration',
       'Which column carries each object''s locking status. Platform configuration, identical in every state; admin-write via its own RLS policy.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'record_status_lock_sources' AND rsss_is_deleted IS NOT TRUE
);

DO $verify$
DECLARE v_kind text; v_unreg integer;
BEGIN
  SELECT resolution_kinds INTO v_kind FROM public.record_state_scope_status()
   WHERE object_name = 'record_status_lock_sources';
  IF v_kind IS DISTINCT FROM 'platform_configuration' THEN
    RAISE EXCEPTION 'record_status_lock_sources registered as %, expected platform_configuration', v_kind;
  END IF;

  -- Deliberately asserts only this change's own row. Three tables were already
  -- unregistered before this migration -- incentive_application_enrollment_field_map,
  -- and portal_download_log + portal_record_grants, which are on the open list
  -- from 2026-08-25. The portal pair needs a real decision about how a granted
  -- record resolves to a state; guessing one here, inside an unrelated change,
  -- is how a security rule ends up wrong. They stay reported, not swept up.
  SELECT count(*) INTO v_unreg FROM public.record_state_scope_status()
   WHERE resolution_kinds = '(unregistered)';
  RAISE NOTICE 'state scoping: % table(s) still unregistered (pre-existing, reported not fixed here)', v_unreg;
END $verify$;

NOTIFY pgrst, 'reload schema';
