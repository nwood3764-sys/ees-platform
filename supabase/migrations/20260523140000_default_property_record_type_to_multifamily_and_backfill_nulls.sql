-- Default property_record_type to MultiFamily on insert (MultiFamily is ~99% of
-- our property types per Nicholas). Backfills the 3 rows that previously had
-- NULL or wrong values:
--   PROP-00011 (NULL)         -> MultiFamily
--   PROP-00012 (NULL)         -> MultiFamily
--   PROP-00014 (Single_Family -> MultiFamily; the earlier session's
--                              Single_Family backfill was a guess, corrected here)
--
-- Active MultiFamily picklist_value.id = 'f3494eea-db52-4ca2-8b98-da0ce88a3cae'

ALTER TABLE properties
  ALTER COLUMN property_record_type SET DEFAULT 'f3494eea-db52-4ca2-8b98-da0ce88a3cae'::uuid;

UPDATE properties
SET property_record_type = 'f3494eea-db52-4ca2-8b98-da0ce88a3cae'::uuid,
    property_updated_at = now()
WHERE property_record_number IN ('PROP-00011','PROP-00012','PROP-00014')
  AND NOT property_is_deleted;
