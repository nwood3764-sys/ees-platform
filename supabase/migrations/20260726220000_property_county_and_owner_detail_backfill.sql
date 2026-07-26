-- Property county + owner-detail backfill.
--
-- 1) property_county: 123 active properties (the manually-created WI outreach
--    batch + 2 NC one-offs) were created without a county, and 177 NC HUD rows
--    imported the literal string 'Unknown'. Fill both from the majority county
--    among HUD-imported properties sharing the same zip5 — every affected zip
--    has an unambiguous real-county majority, verified before authoring.
-- 2) HUD owner details: manually-created properties (never HUD-refreshed) that
--    name an owner org matching a HUD-imported property inherit that org's
--    owner type/address/phone/email. Null-only fill, never clobbers.

-- ---------------------------------------------------------------------------
-- 1) County from zip5 majority
-- ---------------------------------------------------------------------------
WITH zip_majority AS (
  SELECT zip5, property_county AS county
  FROM (
    SELECT left(btrim(property_zip), 5) AS zip5,
           property_county,
           row_number() OVER (
             PARTITION BY left(btrim(property_zip), 5)
             ORDER BY count(*) DESC
           ) AS rn
    FROM properties
    WHERE property_is_deleted IS NOT TRUE
      AND property_county IS NOT NULL
      AND btrim(property_county) NOT IN ('', 'Unknown')
      AND property_zip IS NOT NULL
    GROUP BY 1, 2
  ) ranked
  WHERE rn = 1
)
UPDATE properties p
SET property_county = zm.county,
    property_updated_at = now()
FROM zip_majority zm
WHERE p.property_is_deleted IS NOT TRUE
  AND zm.zip5 = left(btrim(p.property_zip), 5)
  AND (p.property_county IS NULL OR btrim(p.property_county) IN ('', 'Unknown'));

-- ---------------------------------------------------------------------------
-- 2) Owner details for manual properties, from same-org HUD donor rows
-- ---------------------------------------------------------------------------
WITH donors AS (
  SELECT DISTINCT ON (upper(btrim(property_hud_owner_org)))
         upper(btrim(property_hud_owner_org)) AS org,
         property_hud_owner_type,
         property_hud_owner_address,
         property_hud_owner_city,
         property_hud_owner_state,
         property_hud_owner_zip,
         property_hud_owner_phone,
         property_hud_owner_email
  FROM properties
  WHERE property_is_deleted IS NOT TRUE
    AND property_hud_owner_org IS NOT NULL
    AND property_hud_data_refreshed_at IS NOT NULL
    AND (property_hud_owner_type IS NOT NULL
         OR property_hud_owner_address IS NOT NULL
         OR property_hud_owner_phone IS NOT NULL
         OR property_hud_owner_email IS NOT NULL)
  ORDER BY upper(btrim(property_hud_owner_org)),
           property_hud_data_refreshed_at DESC NULLS LAST
)
UPDATE properties p
SET property_hud_owner_type    = COALESCE(p.property_hud_owner_type,    d.property_hud_owner_type),
    property_hud_owner_address = COALESCE(p.property_hud_owner_address, d.property_hud_owner_address),
    property_hud_owner_city    = COALESCE(p.property_hud_owner_city,    d.property_hud_owner_city),
    property_hud_owner_state   = COALESCE(p.property_hud_owner_state,   d.property_hud_owner_state),
    property_hud_owner_zip     = COALESCE(p.property_hud_owner_zip,     d.property_hud_owner_zip),
    property_hud_owner_phone   = COALESCE(p.property_hud_owner_phone,   d.property_hud_owner_phone),
    property_hud_owner_email   = COALESCE(p.property_hud_owner_email,   d.property_hud_owner_email),
    property_updated_at = now()
FROM donors d
WHERE p.property_is_deleted IS NOT TRUE
  AND p.property_hud_data_refreshed_at IS NULL
  AND upper(btrim(p.property_hud_owner_org)) = d.org
  AND (p.property_hud_owner_type IS NULL
       OR p.property_hud_owner_address IS NULL
       OR p.property_hud_owner_phone IS NULL
       OR p.property_hud_owner_email IS NULL);

-- ---------------------------------------------------------------------------
-- 3) Remaining 'Unknown' counties (58 NC rows whose zip has no HUD sibling
--    with a real county — several zips are import typos). The city name is
--    reliable and maps to exactly one NC county for every affected city.
-- ---------------------------------------------------------------------------
WITH city_county(city, county) AS (VALUES
  ('ALBEMARLE','Stanly'),('BISCOE','Montgomery'),('CALABASH','Brunswick'),('CANDLER','Buncombe'),
  ('CASTLE HAYNE','New Hanover'),('CHARLOTTE','Mecklenburg'),('CHEROKEE','Swain'),('CHOCOWINITY','Beaufort'),
  ('CLAREMONT','Catawba'),('CLARKTON','Bladen'),('CONNELLY SPRINGS','Burke'),('DUDLEY','Wayne'),
  ('DUNN','Harnett'),('FAISON','Duplin'),('GREENSBORO','Guilford'),('GREENVILLE','Pitt'),
  ('HIGH POINT','Guilford'),('HILDEBRAN','Burke'),('KANNAPOLIS','Cabarrus'),('KINSTON','Lenoir'),
  ('LAURINBURG','Scotland'),('LEXINGTON','Davidson'),('MOCKSVILLE','Davie'),('MORGANTON','Burke'),
  ('NEW BERN','Craven'),('OCEAN ISLE BEACH','Brunswick'),('PINEVILLE','Mecklenburg'),('PINK HILL','Lenoir'),
  ('POLLOCKSVILLE','Jones'),('POWELLS POINT','Currituck'),('RALEIGH','Wake'),('RICHLANDS','Onslow'),
  ('ROWLAND','Robeson'),('SNEADS FERRY','Onslow'),('STATESVILLE','Iredell'),('SUNSET BEACH','Brunswick'),
  ('WALKERTOWN','Forsyth'),('WHITEVILLE','Columbus'),('WILMINGTON','New Hanover'),('WINSTON SALEM','Forsyth')
)
UPDATE properties p
SET property_county = cc.county, property_updated_at = now()
FROM city_county cc
WHERE p.property_is_deleted IS NOT TRUE
  AND p.property_county = 'Unknown'
  AND p.property_state = 'NC'
  AND upper(btrim(p.property_city)) = cc.city;
