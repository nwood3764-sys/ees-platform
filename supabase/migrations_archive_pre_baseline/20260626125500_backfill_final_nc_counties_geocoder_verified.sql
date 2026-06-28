-- Final NC county backfill for placeholder-address rows, each county verified via
-- the US Census geocoder against a real anchor address in the town:
-- Marshville -> Union, Bostic -> Rutherford, Cleveland -> Rowan, Linwood -> Davidson.
UPDATE properties p
SET property_county = v.county,
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
FROM (VALUES
  ('MARSHVILLE','Union'),
  ('BOSTIC','Rutherford'),
  ('CLEVELAND','Rowan'),
  ('LINWOOD','Davidson')
) AS v(city, county)
WHERE upper(p.property_city) = v.city
  AND p.property_is_deleted = false
  AND p.property_state = 'NC'
  AND p.property_county IS NULL;
