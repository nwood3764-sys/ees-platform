-- Re-point every remaining consumer of the soon-to-be-dropped enrollment_* / ia_*
-- copy columns to the parent record, so the columns become provably unreferenced.
-- NON-DESTRUCTIVE — no column is dropped here (that's the next migration, applied
-- only after the client code that stops selecting these columns is live). Functions
-- are rewritten by exact string replacement of their live definitions so nothing
-- else in their bodies can drift.

-- 1. default_enrollment_contractor_account: the enrollment's state fallback now
--    comes from the linked property, not a dropped enrollment_state column.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
   WHERE proname='default_enrollment_contractor_account' AND pronamespace='public'::regnamespace;
  d := replace(d, 'NEW.enrollment_state',
                  '(SELECT property_state FROM properties WHERE id = NEW.property_id)');
  EXECUTE d;
END $$;

-- 2. resolve_outbound_mailbox_for_anchor: drop the incentive_applications primary
--    read of ia_installation_address_state; the property_state fallback (already
--    present two lines down) becomes the source.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
   WHERE proname='resolve_outbound_mailbox_for_anchor' AND pronamespace='public'::regnamespace;
  d := replace(d, 'ia.ia_installation_address_state', 'NULL::text');
  EXECUTE d;
END $$;

-- 3. global_search: search incentive applications by the OWNER via the property
--    (property_hud_owner_org) instead of the dropped ia_building_owner_name — this
--    also fixes owner search for new applications (whose copy was already stopped).
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
   WHERE proname='global_search' AND pronamespace='public'::regnamespace;
  d := replace(d, 'FROM incentive_applications ia, pat',
                  'FROM incentive_applications ia LEFT JOIN properties pr_ia ON pr_ia.id = ia.property_id, pat');
  d := replace(d, 'ia.ia_building_owner_name', 'pr_ia.property_hud_owner_org');
  EXECUTE d;
END $$;

-- 4. RPT-00033 "Enrollments by Status": its "Enrollment Property Name" column read
--    the dropped enrollment_property_name — re-point it to the Property's name via
--    the property_id lookup (same via_path shape the report already uses).
UPDATE public.reports r
SET rpt_selected_fields = (
  SELECT jsonb_agg(
    CASE WHEN f->>'name' = 'enrollment_property_name' AND f->>'table' = 'enrollments'
      THEN jsonb_build_object('name','property_name','type','text','label','Property Name',
                              'table','properties','via_path', jsonb_build_array('property_id'))
      ELSE f END)
  FROM jsonb_array_elements(r.rpt_selected_fields) f
),
updated_at = now()
WHERE r.rpt_record_number = 'RPT-00033' AND r.is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
