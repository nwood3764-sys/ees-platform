-- Property county: fill every remaining blank AND stop the gap from recurring.
--
-- The 2026-07-26 backfill (20260726223000) filled county for the then-current
-- active properties, but two things left blanks behind:
--   1) Properties created AFTER that migration were never derived — nothing sets
--      county on create, so 8 active WI outreach properties came in blank again.
--   2) That backfill was scoped to `property_is_deleted IS NOT TRUE`, so ~1,900
--      soft-deleted rows kept their blank/'Unknown' county (a user hitting one by
--      direct URL sees an empty County field even though the record is deleted).
--
-- Fix:
--   A) One-time backfill of ALL rows (deleted included), null/blank/'Unknown'
--      only, derived from the address. County is resolved by STATE-SCOPED zip5
--      majority, falling back to STATE+city majority. State scoping matters:
--      some manual WI rows carry mistyped out-of-state zips (e.g. 50125 is an
--      Iowa zip on a Madison WI property) — an unscoped zip majority would set
--      the wrong (Iowa) county, while state+city correctly yields Dane.
--   B) A BEFORE INSERT/UPDATE trigger that derives county the same way whenever
--      it is left blank, so new properties never ship without a county again.

-- ---------------------------------------------------------------------------
-- A) One-time backfill (all rows, blank-only), two correlated passes
-- ---------------------------------------------------------------------------
-- Pass 1: state + zip5 majority
UPDATE properties p
SET property_county = zm.county,
    property_updated_at = now()
FROM (
  SELECT state, zip5, county FROM (
    SELECT property_state AS state,
           left(btrim(property_zip), 5) AS zip5,
           property_county AS county,
           row_number() OVER (
             PARTITION BY property_state, left(btrim(property_zip), 5)
             ORDER BY count(*) DESC, property_county
           ) AS rn
    FROM properties
    WHERE property_county IS NOT NULL
      AND btrim(property_county) NOT IN ('', 'Unknown')
      AND property_zip IS NOT NULL
      AND property_state IS NOT NULL
    GROUP BY 1, 2, 3
  ) r WHERE rn = 1
) zm
WHERE (p.property_county IS NULL OR btrim(p.property_county) IN ('', 'Unknown'))
  AND p.property_state = zm.state
  AND left(btrim(p.property_zip), 5) = zm.zip5;

-- Pass 2: state + city majority (covers rows whose zip has no in-state sibling,
-- e.g. mistyped out-of-state zips)
UPDATE properties p
SET property_county = cm.county,
    property_updated_at = now()
FROM (
  SELECT state, city, county FROM (
    SELECT property_state AS state,
           upper(btrim(property_city)) AS city,
           property_county AS county,
           row_number() OVER (
             PARTITION BY property_state, upper(btrim(property_city))
             ORDER BY count(*) DESC, property_county
           ) AS rn
    FROM properties
    WHERE property_county IS NOT NULL
      AND btrim(property_county) NOT IN ('', 'Unknown')
      AND property_city IS NOT NULL
      AND property_state IS NOT NULL
    GROUP BY 1, 2, 3
  ) r WHERE rn = 1
) cm
WHERE (p.property_county IS NULL OR btrim(p.property_county) IN ('', 'Unknown'))
  AND p.property_state = cm.state
  AND upper(btrim(p.property_city)) = cm.city;

-- ---------------------------------------------------------------------------
-- B) Derivation trigger — never let a property save without a county again
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_property_county()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_zip5   text;
  v_county text;
BEGIN
  -- Only derive when county is missing; never clobber a real value.
  IF NEW.property_county IS NOT NULL
     AND btrim(NEW.property_county) NOT IN ('', 'Unknown') THEN
    RETURN NEW;
  END IF;

  IF NEW.property_state IS NULL THEN
    RETURN NEW;
  END IF;

  v_zip5 := left(btrim(COALESCE(NEW.property_zip, '')), 5);

  -- State-scoped zip5 majority
  IF v_zip5 <> '' THEN
    SELECT property_county INTO v_county
    FROM public.properties
    WHERE property_is_deleted IS NOT TRUE
      AND property_state = NEW.property_state
      AND left(btrim(property_zip), 5) = v_zip5
      AND property_county IS NOT NULL
      AND btrim(property_county) NOT IN ('', 'Unknown')
    GROUP BY property_county
    ORDER BY count(*) DESC, property_county
    LIMIT 1;
  END IF;

  -- Fallback: state + city majority
  IF v_county IS NULL AND NEW.property_city IS NOT NULL THEN
    SELECT property_county INTO v_county
    FROM public.properties
    WHERE property_is_deleted IS NOT TRUE
      AND property_state = NEW.property_state
      AND upper(btrim(property_city)) = upper(btrim(NEW.property_city))
      AND property_county IS NOT NULL
      AND btrim(property_county) NOT IN ('', 'Unknown')
    GROUP BY property_county
    ORDER BY count(*) DESC, property_county
    LIMIT 1;
  END IF;

  IF v_county IS NOT NULL THEN
    NEW.property_county := v_county;
  END IF;

  RETURN NEW;
END;
$function$;

-- SECURITY INVOKER (default): the trigger only reads properties the caller can
-- already read, so no elevated privileges are needed and no security-definer
-- advisor lint is introduced.

DROP TRIGGER IF EXISTS trg_properties_set_county ON public.properties;
-- Named to sort AFTER trg_properties_normalize_address so the address is
-- normalized before we read state/city/zip.
CREATE TRIGGER trg_properties_set_county
  BEFORE INSERT OR UPDATE OF property_county, property_state, property_city, property_zip
  ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_property_county();
