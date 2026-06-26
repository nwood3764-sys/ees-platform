-- Reconcile remaining null-county NC rows by CITY: assign the county established
-- by other populated NC properties in the same city (most common, excluding
-- "Unknown"). These rows have a real city but a placeholder street/ZIP, so the
-- city is the reliable address signal. Resolved 61 rows.
WITH city_county AS (
  SELECT property_county,
         upper(property_city) AS city_u,
         ROW_NUMBER() OVER (PARTITION BY upper(property_city) ORDER BY COUNT(*) DESC) AS rk
  FROM properties
  WHERE property_is_deleted=false AND property_state='NC'
    AND property_county IS NOT NULL AND property_county <> 'Unknown'
    AND property_city IS NOT NULL
  GROUP BY property_county, upper(property_city)
)
UPDATE properties p
SET property_county = cc.property_county,
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
FROM city_county cc
WHERE cc.city_u = upper(p.property_city) AND cc.rk = 1
  AND p.property_is_deleted = false
  AND p.property_state = 'NC'
  AND p.property_county IS NULL;
