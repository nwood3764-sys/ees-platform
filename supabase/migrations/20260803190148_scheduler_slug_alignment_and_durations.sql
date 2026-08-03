-- Customer scheduler: align multifamily work_type public slugs with the deployed
-- frontend, and set Single-Family/Townhome assessment durations to 45 minutes.
--
-- The customer scheduler frontend (src/serviceAppointments — SLUG_META /
-- SlugIndex) keys the multifamily flows off 'multifamily-energy-assessment' and
-- 'multifamily-diagnostic-assessment', but the work_types rows carried the
-- shorter slugs 'multifamily-assessment' / 'multifamily-diagnostic'. Because
-- compute-availability / create-service-appointment resolve the work type by
-- work_type_public_slug, the multifamily pages loaded (frontend metadata exists)
-- but the backend could not resolve the work type, so booking dead-ended to the
-- dispatcher-followup fallback ("No availability ... a dispatcher will reach
-- out"). Renaming the DB slugs to match the frontend fixes the whole chain.
--
-- Also: Single-Family Energy Assessment (was 90 min) and Townhome Energy
-- Assessment (was 30 min) durations are set to 45 minutes.

UPDATE work_types SET work_type_public_slug = 'multifamily-energy-assessment',
       work_type_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
 WHERE work_type_public_slug = 'multifamily-assessment' AND work_type_is_deleted IS NOT TRUE;

UPDATE work_types SET work_type_public_slug = 'multifamily-diagnostic-assessment',
       work_type_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
 WHERE work_type_public_slug = 'multifamily-diagnostic' AND work_type_is_deleted IS NOT TRUE;

UPDATE work_types SET work_type_duration_minutes = 45,
       work_type_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
 WHERE work_type_public_slug = 'single-family-assessment' AND work_type_is_deleted IS NOT TRUE;

UPDATE work_types SET work_type_duration_minutes = 45,
       work_type_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
 WHERE work_type_public_slug = 'townhome-assessment' AND work_type_is_deleted IS NOT TRUE;
