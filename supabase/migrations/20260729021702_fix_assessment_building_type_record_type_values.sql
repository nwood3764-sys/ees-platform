-- Fix: New Assessment (LEAP Pad) fails when creating a NEW building/unit.
-- =============================================================================
-- The record-type value standardization (20260728181719) rebuilt
-- create_assessment_work_order but only swapped the 'property_owner' and
-- 'single_family_energy_assessment' literals — it MISSED the building record-type
-- literals 'single_family_detached' / 'single_family_attached'. Those values were
-- renamed to 'SINGLE-FAMILY-DETACHED' / 'SINGLE-FAMILY-ATTACHED' in the same
-- migration, so the RPC's checks now reference values that no longer exist:
--
--   * `p_new_building_type NOT IN ('single_family_detached','single_family_attached')`
--     rejects the client's uppercase-hyphen value -> "Choose the building type",
--     which is exactly the failure a technician hits creating a new building/unit
--     from LEAP Pad. (The client — NewAssessmentSheet.jsx — already sends the
--     standardized values, matching picklist_values.)
--   * the `v_bld_rt = 'single_family_detached' / '...attached'` comparisons never
--     match either, so the detached "no unit" branch and the attached "unit
--     required" branch stop working.
--
-- Fix: re-read the live definition and swap ONLY those two exact quoted literals
-- to the standardized values, then re-create the function (CREATE OR REPLACE
-- preserves ownership + grants). This mirrors the swap pattern the standardization
-- migration used, so nothing else in the body changes. No unit/building NAME is
-- restricted anywhere — unit_number / unit_name accept free text (numbers,
-- letters, alphanumeric, any mix); this only repairs the record-type resolution.
-- =============================================================================

DO $mig$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
           WHERE proname = 'create_assessment_work_order' AND pronamespace = 'public'::regnamespace LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''single_family_detached''', '''SINGLE-FAMILY-DETACHED''');
    d := replace(d, '''single_family_attached''', '''SINGLE-FAMILY-ATTACHED''');
    EXECUTE d;
  END LOOP;
END $mig$;

-- Re-issue grants + reload PostgREST (standard after CREATE OR REPLACE).
REVOKE ALL ON FUNCTION public.create_assessment_work_order(uuid, text, uuid, text, text, text, text, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_assessment_work_order(uuid, text, uuid, text, text, text, text, uuid, text, uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
