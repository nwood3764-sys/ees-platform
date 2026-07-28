-- Standardize record-type picklist VALUES to a single convention: UPPERCASE-HYPHEN.
-- =============================================================================
-- Record-type Values are the internal API-name keys stored in
-- picklist_values (picklist_field='record_type'). Historically they were
-- lowercase_underscore on every object except `enrollments`, which was seeded
-- with lowercase-hyphen. This normalizes ALL of them to UPPERCASE-HYPHEN so the
-- convention is uniform (matching the already-uppercase display Labels).
--
-- Records link to their record type by picklist_values.id (UUID), NOT by this
-- string, so renaming the string does not affect any record's record-type
-- assignment. What DOES matter: code / DB functions that resolve a record type
-- BY its string value. Those are updated in lockstep below.
--
-- DELIBERATELY EXCLUDED (left exactly as-is):
--   * envelopes / envelope_recipients / envelope_tabs / envelope_events —
--     the e-signature pipeline's edge functions already look these up with a
--     mismatched casing ("Standard" vs stored "standard"), i.e. the lookup is
--     vestigial; renaming would change signing behavior for objects no user
--     ever sees. Left untouched so the signing pipeline is not disturbed.
--   * portal_users — record_type ("Provider User") is stored/compared as TEXT
--     and wired into provider-portal auth (RPCs + ProviderPortalRoot); renaming
--     it would break portal access.
-- =============================================================================

-- 1) Rename the values. UPPER + collapse spaces/underscores to a single hyphen.
--    Bijective within each object (no collisions), so the unique index holds; a
--    collision would abort the whole migration, which is the safe outcome.
UPDATE public.picklist_values
SET picklist_value = upper(regexp_replace(picklist_value, '[ _]+', '-', 'g'))
WHERE picklist_field = 'record_type'
  AND picklist_object NOT IN
    ('envelopes','envelope_recipients','envelope_tabs','envelope_events','portal_users');

-- 2) Update the DB functions that resolve a record type by a HARDCODED value
--    literal. Each block re-reads the live definition and swaps only the exact
--    quoted record-type literals (leaving unrelated literals like status values
--    untouched), then re-creates the function. CREATE OR REPLACE preserves
--    ownership and grants. Already-mismatched literals (e.g. 'MultiFamily',
--    'Standard') are intentionally NOT touched — they resolve to null today and
--    keep doing so, so behavior is unchanged.

DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname='create_assessment_work_order' AND pronamespace='public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''property_owner''', '''PROPERTY-OWNER''');
    d := replace(d, '''single_family_energy_assessment''', '''SINGLE-FAMILY-ENERGY-ASSESSMENT''');
    EXECUTE d;
  END LOOP;
END $mig$;

DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname='create_homes_intake' AND pronamespace='public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''nc_ira_sf_homes_audit''', '''NC-IRA-SF-HOMES-AUDIT''');
    d := replace(d, '''single_family_energy_assessment''', '''SINGLE-FAMILY-ENERGY-ASSESSMENT''');
    d := replace(d, '''single_family''', '''SINGLE-FAMILY''');
    EXECUTE d;
  END LOOP;
END $mig$;

DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname='create_service_appointment' AND pronamespace='public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''single_family_energy_assessment''', '''SINGLE-FAMILY-ENERGY-ASSESSMENT''');
    d := replace(d, '''single_family''', '''SINGLE-FAMILY''');
    EXECUTE d;
  END LOOP;
END $mig$;

DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname='create_service_provider_application' AND pronamespace='public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''service_provider''', '''SERVICE-PROVIDER''');
    EXECUTE d;
  END LOOP;
END $mig$;

DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname='create_technician_work_order_for_property' AND pronamespace='public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''field_documentation''', '''FIELD-DOCUMENTATION''');
    d := replace(d, '''field_operations''', '''FIELD-OPERATIONS''');
    EXECUTE d;
  END LOOP;
END $mig$;

DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname='create_vehicle_daily_inspection' AND pronamespace='public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''daily_inspection''', '''DAILY-INSPECTION''');
    EXECUTE d;
  END LOOP;
END $mig$;

DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname='import_property_batch' AND pronamespace='public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    -- only the accounts record type ('property_owner') currently matches; the
    -- properties literal 'MultiFamily' is already mismatched with stored
    -- 'multifamily', so it is intentionally left alone.
    d := replace(d, '''property_owner''', '''PROPERTY-OWNER''');
    EXECUTE d;
  END LOOP;
END $mig$;

-- Unit-count rollups resolve the units record type by value 'Dwelling Unit'.
DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname IN ('recompute_account_rollups','recompute_building_rollups','recompute_property_rollups')
             AND pronamespace='public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''Dwelling Unit''', '''DWELLING-UNIT''');
    EXECUTE d;
  END LOOP;
END $mig$;

-- 3) Reload PostgREST schema cache (function bodies changed).
NOTIFY pgrst, 'reload schema';
