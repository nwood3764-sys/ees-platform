-- Backfill unit counts for Section 9 PHA properties that carry a development
-- code, joining to the staged HUD public-housing source (stg_hud_ph) by
-- development_code. Only the housing-authority-linked rows have a dev code; the
-- "Unknown Owner — NC" rows have no dev/participant code and their coordinates
-- do not align with staging, so they are not recoverable here.
UPDATE properties p
SET property_total_number_of_units = s.total_units,
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
FROM stg_hud_ph s
WHERE s.development_code = p.property_ph_development_code
  AND p.property_is_deleted = false
  AND p.property_total_number_of_units IS NULL
  AND s.total_units IS NOT NULL;
