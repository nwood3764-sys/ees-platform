-- Buildings must show their state everywhere they appear (list views,
-- related lists, search, reports). Every live building had NULL
-- building_address/building_city/building_state/building_zip — the location
-- never came over from the parent property at import. Two fixes:
--
-- 1. Widen the four location columns from varchar(30)/(2)/(5) to text,
--    matching properties' location columns. The related-list "New Building"
--    prefill already copies property_street into building_address, so a
--    street longer than 30 characters would fail the insert today.
-- 2. Backfill blanks from the parent property. Fill-blanks-only: a building
--    that already carries its own location is never overwritten. A multi-
--    building property's buildings can still be edited to distinct addresses
--    afterward.

ALTER TABLE public.buildings
  ALTER COLUMN building_address TYPE text,
  ALTER COLUMN building_city    TYPE text,
  ALTER COLUMN building_state   TYPE text,
  ALTER COLUMN building_zip     TYPE text;

UPDATE public.buildings b
SET building_address    = COALESCE(NULLIF(TRIM(b.building_address), ''), NULLIF(TRIM(p.property_street), '')),
    building_city       = COALESCE(NULLIF(TRIM(b.building_city), ''),    NULLIF(TRIM(p.property_city), '')),
    building_state      = COALESCE(NULLIF(TRIM(b.building_state), ''),   NULLIF(TRIM(p.property_state), '')),
    building_zip        = COALESCE(NULLIF(TRIM(b.building_zip), ''),     NULLIF(TRIM(p.property_zip), '')),
    building_updated_at = now()
FROM public.properties p
WHERE p.id = b.property_id
  AND COALESCE(b.building_is_deleted, false) = false
  AND (   (NULLIF(TRIM(b.building_address), '') IS NULL AND NULLIF(TRIM(p.property_street), '') IS NOT NULL)
       OR (NULLIF(TRIM(b.building_city), '')    IS NULL AND NULLIF(TRIM(p.property_city), '')   IS NOT NULL)
       OR (NULLIF(TRIM(b.building_state), '')   IS NULL AND NULLIF(TRIM(p.property_state), '')  IS NOT NULL)
       OR (NULLIF(TRIM(b.building_zip), '')     IS NULL AND NULLIF(TRIM(p.property_zip), '')    IS NOT NULL) );
