-- Final two NC county assignments, confirmed against authoritative public sources:
-- Connelly Springs -> Burke County; Buies Creek (Campbell University) -> Harnett County.
UPDATE properties p
SET property_county = v.county,
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
FROM (VALUES
  ('CONNELLY SPRINGS','Burke'),
  ('BUIES CREEK','Harnett')
) AS v(city, county)
WHERE upper(p.property_city) = v.city
  AND p.property_is_deleted = false
  AND p.property_state = 'NC'
  AND p.property_county IS NULL;
