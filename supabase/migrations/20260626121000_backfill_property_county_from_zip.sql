-- Backfill property_county for NC properties missing it, deriving county from
-- ZIP using NC properties that already have a known county for that ZIP.
-- Purely in-database; no external source. Idempotent: fills only null county.
--
-- Recovers ~1,213 of ~1,368 null-county NC rows. The remainder have ZIPs not
-- covered by any populated row and need a fuller ZIP->county table or lat/lng
-- derivation (tracked separately).
BEGIN;

WITH zip_county AS (
  SELECT DISTINCT ON (property_zip) property_zip, property_county
  FROM properties
  WHERE property_is_deleted = false
    AND property_state = 'NC'
    AND property_county IS NOT NULL
    AND property_county <> 'Unknown'
    AND property_zip IS NOT NULL
  ORDER BY property_zip, property_county
)
UPDATE properties p
SET property_county = zc.property_county,
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
FROM zip_county zc
WHERE zc.property_zip = p.property_zip
  AND p.property_is_deleted = false
  AND p.property_state = 'NC'
  AND p.property_county IS NULL;

COMMIT;
