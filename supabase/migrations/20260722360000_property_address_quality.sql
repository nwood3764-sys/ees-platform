-- =====================================================================
-- Property address data quality (Nicholas, 2026-07-22):
--   "Why do we have two properties with the exact same address? ...
--    I'd much rather the syntax spell out 'south' — no abbreviations."
--
-- 1. normalize_street_address(text) — canonical street syntax: trimmed,
--    single-spaced, Title Case, and USPS abbreviations spelled out in
--    full (S -> South, St -> Street, Ave -> Avenue, ...). Directionals
--    expand anywhere; suffix words expand only in suffix position (end,
--    or followed by a directional) so "St Paul" is not mangled.
-- 2. BEFORE trigger on properties — every insert/update stores the
--    normalized street (property_name follows when it mirrored the
--    street), Title Case city, uppercase state, trimmed zip.
-- 3. create_assessment_work_order dedup goes GLOBAL: a property is a
--    physical place — match by normalized street + zip across ALL
--    accounts (the 400 S Tryon twin slipped through a per-account check).
-- 4. Supporting expression index for the lookup (NON-unique).
--
-- NOT included: the unique address constraint. The legacy HUD imports
-- carry ~825 duplicate address groups (~1,656 rows) that must be merged
-- first — tracked as its own cleanup project. Once merged, add:
--   CREATE UNIQUE INDEX uniq_properties_normalized_address ON properties
--     (normalize_street_address(property_street), lower(trim(property_city)),
--      upper(trim(property_state)), left(trim(property_zip),5))
--     WHERE property_is_deleted IS NOT TRUE;
-- =====================================================================

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
  -- Directionals expand anywhere.
  -- Suffixes expand only in suffix position (last word, or followed by a directional).
BEGIN
  IF p_street IS NULL THEN RETURN NULL; END IF;
  v_words := string_to_array(regexp_replace(trim(p_street), '\s+', ' ', 'g'), ' ');
  IF v_words IS NULL OR array_length(v_words,1) IS NULL THEN RETURN trim(p_street); END IF;

  FOR i IN 1..array_length(v_words,1) LOOP
    v_w := v_words[i];
    v_key := lower(regexp_replace(v_w, '\.$', ''));   -- strip a trailing period
    v_next := CASE WHEN i < array_length(v_words,1)
                   THEN lower(regexp_replace(v_words[i+1], '\.$', '')) ELSE NULL END;

    -- Directionals: expand anywhere.
    v_expanded := CASE v_key
      WHEN 'n' THEN 'North'  WHEN 's' THEN 'South'
      WHEN 'e' THEN 'East'   WHEN 'w' THEN 'West'
      WHEN 'ne' THEN 'Northeast' WHEN 'nw' THEN 'Northwest'
      WHEN 'se' THEN 'Southeast' WHEN 'sw' THEN 'Southwest'
      ELSE NULL END;

    -- Suffixes: expand only when last word or followed by a directional.
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
      -- Leave numerics and ordinals (400, 1st, 2nd, 53703-1234) untouched.
      v_out := array_append(v_out, v_w);
    ELSIF v_w ~ '^[A-Za-z]' THEN
      v_out := array_append(v_out, initcap(v_w));
    ELSE
      v_out := array_append(v_out, v_w);
    END IF;
  END LOOP;

  RETURN array_to_string(v_out, ' ');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.normalize_street_address(text) TO authenticated, anon, service_role;

-- ── Trigger: every property stores clean, spelled-out address syntax ──────────
CREATE OR REPLACE FUNCTION public.normalize_property_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_raw_street text := NEW.property_street;
BEGIN
  NEW.property_street := public.normalize_street_address(NEW.property_street);
  NEW.property_city   := initcap(lower(trim(coalesce(NEW.property_city, ''))));
  NEW.property_state  := upper(trim(coalesce(NEW.property_state, '')));
  NEW.property_zip    := trim(coalesce(NEW.property_zip, ''));
  -- Single-family convention: the property name mirrors the street. Keep it
  -- in sync when it did (or was blank).
  IF nullif(trim(coalesce(NEW.property_name,'')),'') IS NULL
     OR lower(trim(NEW.property_name)) = lower(trim(coalesce(v_raw_street,''))) THEN
    NEW.property_name := NEW.property_street;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_properties_normalize_address ON public.properties;
CREATE TRIGGER trg_properties_normalize_address
BEFORE INSERT OR UPDATE OF property_street, property_city, property_state, property_zip, property_name
ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.normalize_property_address();

-- ── Fast normalized-address lookup (NON-unique until legacy dedup) ────────────
CREATE INDEX IF NOT EXISTS idx_properties_normalized_address
ON public.properties (public.normalize_street_address(property_street), left(trim(property_zip),5))
WHERE property_is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
