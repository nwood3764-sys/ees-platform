-- =====================================================================
-- Building naming convention in create_service_appointment (Nicholas,
-- 2026-07-22): buildings are NUMBERED — the number is the street address
-- number ("Building 400"), never a colloquial name. The customer
-- self-scheduling RPC was creating buildings named 'Main'; patch that
-- single literal to the street-number convention used everywhere else.
--
-- Surgical: pulls the LIVE definition and replaces only the 'Main'
-- literal, guarded to exactly-one occurrence, so the rest of the booking
-- pipeline is untouched (the SA notification pipeline is not modified).
-- The two existing 'Main' buildings were renamed to their street numbers
-- (400, 812) in the same change.
-- =====================================================================
DO $$
DECLARE
  v_def text;
  v_n   int;
BEGIN
  SELECT pg_get_functiondef('public.create_service_appointment(jsonb)'::regprocedure) INTO v_def;
  v_n := (length(v_def) - length(replace(v_def, '''Main''', ''))) / length('''Main''');
  IF v_n = 0 THEN
    RAISE NOTICE 'create_service_appointment: no ''Main'' literal — already patched, skipping.';
    RETURN;
  ELSIF v_n > 1 THEN
    RAISE EXCEPTION 'create_service_appointment: expected exactly 1 ''Main'' literal, found % — refusing to patch blindly.', v_n;
  END IF;
  v_def := replace(v_def, '''Main''',
                   'coalesce(nullif(split_part(coalesce(v_street,''''),'' '',1),''''),''1'')');
  EXECUTE v_def;
END $$;

NOTIFY pgrst, 'reload schema';
