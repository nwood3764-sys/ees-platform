-- Register the new field-map table with geographic record scoping.
--
-- record_state_scope_status() must report ZERO unregistered objects (the
-- 2026-08-23 rule: all 245 public base tables classified). A new base table
-- that nobody registers silently becomes an object nobody can say whether a
-- state-restricted user may see. This one is platform CONFIGURATION -- it maps
-- record types to columns and holds no record belonging to any state -- so it
-- carries no state-scope policy, exactly like external_form_field_map.
INSERT INTO public.record_state_scope_sources
  (rsss_object_name, rsss_resolution_kind, rsss_path_order, rsss_notes,
   rsss_owner, rsss_created_by)
SELECT 'incentive_application_enrollment_field_map', 'platform_configuration', 1,
       'Configuration: which incentive-application record type inherits which columns from which enrollment record type. Holds no state-bearing record.',
       u.id, u.id
FROM (SELECT id FROM public.users WHERE user_is_deleted IS NOT TRUE
       ORDER BY user_created_at LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'incentive_application_enrollment_field_map'
     AND rsss_is_deleted IS NOT TRUE);

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'incentive_application_enrollment_field_map'
     AND rsss_is_deleted IS NOT TRUE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 scope source row for the field map, found %', v_n;
  END IF;
END $$;
