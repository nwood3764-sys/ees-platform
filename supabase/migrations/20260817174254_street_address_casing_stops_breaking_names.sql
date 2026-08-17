-- Street-address casing stops turning correct data into wrong data, then the
-- ALL-CAPS import backfill runs.
--
-- Nicholas, 2026-08-17: "If you think you can change all of the properties all
-- caps import without messing anything up, go ahead."
--
-- Measuring it first showed the backfill would have introduced NEW errors on
-- 17,144 properties, because normalize_street_address()'s casing step is a bare
-- initcap():
--
--   "901 McVey St"      -> "901 Mcvey Street"      (37 rows already correct)
--   "100 MCGEE CT"      -> "100 Mcgee Court"       (154 Mc/Mac rows)
--   "1944 US HWY 70"    -> "1944 Us Hwy 70"        (58 US/NC/SC rows)
--   "702 17Th ST"       -> "702 17Th Street"       (1 row)
--
-- That is a live bug, not just a backfill problem: it already degraded every
-- property anyone edited. Four rules, each deliberately conservative:
--
--   1. A word that is ALREADY deliberately mixed-case is left alone. McVey,
--      MacArthur, O'Brien, DeSoto were right; initcap flattened them.
--   2. An all-caps Mc name is rebuilt as McX. Unambiguous — no ordinary word
--      starts "Mc" followed by another capital. Mac is deliberately NOT treated
--      this way, because Macon, Macy and Mackinaw are not Mac-names and guessing
--      would do more harm than good (MACARTHUR still lands as "Macarthur").
--   3. US / NC / SC highway designators keep their case, including "US-281".
--      Only when the source is already uppercase, so the ordinary word "us" is
--      never shouted.
--   4. Ordinals get a lowercase suffix: "17Th" -> "17th".
--
-- Everything else — the abbreviation expansion, the directional expansion, the
-- word order — is byte-for-byte unchanged.
--
-- idx_properties_normalized_address is a functional index over this function, so
-- it is reindexed. Without that its entries describe the old output and
-- create-time duplicate detection would silently stop matching.
CREATE OR REPLACE FUNCTION public.normalize_street_address(p_street text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_words text[];
  v_out   text[] := ARRAY[]::text[];
  v_w     text;
  v_key   text;
  v_next  text;
  v_expanded text;
  i int;
BEGIN
  IF p_street IS NULL THEN RETURN NULL; END IF;
  v_words := string_to_array(regexp_replace(trim(p_street), '\s+', ' ', 'g'), ' ');
  IF v_words IS NULL OR array_length(v_words,1) IS NULL THEN RETURN trim(p_street); END IF;

  FOR i IN 1..array_length(v_words,1) LOOP
    v_w := v_words[i];
    v_key := lower(regexp_replace(v_w, '\.$', ''));
    v_next := CASE WHEN i < array_length(v_words,1)
                   THEN lower(regexp_replace(v_words[i+1], '\.$', '')) ELSE NULL END;

    v_expanded := CASE v_key
      WHEN 'n' THEN 'North'  WHEN 's' THEN 'South'
      WHEN 'e' THEN 'East'   WHEN 'w' THEN 'West'
      WHEN 'ne' THEN 'Northeast' WHEN 'nw' THEN 'Northwest'
      WHEN 'se' THEN 'Southeast' WHEN 'sw' THEN 'Southwest'
      ELSE NULL END;

    IF v_expanded IS NULL AND (i = array_length(v_words,1)
        OR v_next IN ('n','s','e','w','ne','nw','se','sw',
                      'north','south','east','west','northeast','northwest','southeast','southwest')) THEN
      v_expanded := CASE v_key
        WHEN 'st'   THEN 'Street'    WHEN 'ave' THEN 'Avenue'  WHEN 'av'  THEN 'Avenue'
        WHEN 'rd'   THEN 'Road'      WHEN 'dr'  THEN 'Drive'   WHEN 'ln'  THEN 'Lane'
        WHEN 'blvd' THEN 'Boulevard' WHEN 'ct'  THEN 'Court'   WHEN 'pl'  THEN 'Place'
        WHEN 'cir'  THEN 'Circle'    WHEN 'ter' THEN 'Terrace' WHEN 'trl' THEN 'Trail'
        WHEN 'hwy'  THEN 'Highway'   WHEN 'pkwy' THEN 'Parkway' WHEN 'sq' THEN 'Square'
        WHEN 'ctr'  THEN 'Center'    WHEN 'crt' THEN 'Court'
        ELSE NULL END;
    END IF;

    IF v_expanded IS NOT NULL THEN
      v_out := array_append(v_out, v_expanded);

    ELSIF v_w ~ '^[0-9]' THEN
      -- Rule 4: ordinals get a lowercase suffix ("17Th" -> "17th"). House
      -- numbers, "3747-A" and "E5125" pass through untouched.
      IF v_w ~* '^[0-9]+(st|nd|rd|th)$' THEN
        v_out := array_append(v_out, lower(v_w));
      ELSE
        v_out := array_append(v_out, v_w);
      END IF;

    ELSIF v_w ~ '^(US|NC|SC)([^A-Za-z]|$)' THEN
      -- Rule 3: highway designators keep their case: "US HWY 70", "US-281".
      v_out := array_append(v_out, v_w);

    ELSIF v_w ~ '[a-z]' AND substring(v_w from 2) ~ '[A-Z]' THEN
      -- Rule 1: already deliberately mixed-case, so leave it exactly as it is.
      v_out := array_append(v_out, v_w);

    ELSIF v_w ~ '^MC[A-Z]' THEN
      -- Rule 2: all-caps Mc name -> McX.
      v_out := array_append(v_out, 'Mc' || initcap(substring(v_w from 3)));

    ELSIF v_w ~ '^[A-Za-z]' THEN
      v_out := array_append(v_out, initcap(v_w));
    ELSE
      v_out := array_append(v_out, v_w);
    END IF;
  END LOOP;

  RETURN array_to_string(v_out, ' ');
END;
$function$;

-- The functional index stores the OLD output for every existing row.
REINDEX INDEX public.idx_properties_normalized_address;

-- The backfill itself. The BEFORE trigger does the normalizing, so touching a
-- watched column is enough. Idempotent: a row stops matching the predicate once
-- its stored values equal what the trigger would produce. Run in batches on prod
-- (3,000 fits inside the API statement timeout; 4,000 does not).
UPDATE public.properties
   SET property_street = property_street
 WHERE property_is_deleted IS NOT TRUE
   AND (
     public.normalize_street_address(property_street) IS DISTINCT FROM property_street
     OR initcap(lower(trim(coalesce(property_city,'')))) IS DISTINCT FROM property_city
     OR COALESCE(
          public.append_name_segment(
            NULLIF(btrim(public.normalize_street_address(property_street)), ''),
            NULLIF(btrim(initcap(lower(trim(coalesce(property_city,''))))), '')),
          NULLIF(btrim(coalesce(property_name,'')), ''), property_name
        ) IS DISTINCT FROM property_name
   );

-- Then recompose the rest of the chain, in dependency order, so every derived
-- name matches its own rule rather than only the rows whose parent happened to
-- change. Projects and work orders are handled by the two migrations that
-- follow (they needed trigger fixes first).
UPDATE public.buildings     SET building_name = building_name       WHERE building_is_deleted    IS NOT TRUE;
UPDATE public.units         SET unit_name = unit_name               WHERE unit_is_deleted        IS NOT TRUE;
UPDATE public.opportunities SET opportunity_name = opportunity_name WHERE opportunity_is_deleted IS NOT TRUE;
UPDATE public.assessments   SET assessment_updated_at = now()       WHERE assessment_is_deleted  IS NOT TRUE;
UPDATE public.incentive_applications SET ia_name = ia_name          WHERE ia_is_deleted          IS NOT TRUE;
UPDATE public.service_appointments   SET sa_name = sa_name          WHERE sa_is_deleted          IS NOT TRUE;
UPDATE public.service_appointment_assignments SET saa_name = saa_name WHERE saa_is_deleted       IS NOT TRUE;
UPDATE public.work_plans    SET work_plan_name = work_plan_name     WHERE work_plan_is_deleted   IS NOT TRUE;
UPDATE public.work_steps    SET work_step_name = work_step_name     WHERE work_step_is_deleted   IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
