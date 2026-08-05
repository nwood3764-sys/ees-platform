-- Lutheran Social Services property marketing descriptions
-- Adds a purpose-built column to hold the owner-provided public marketing/eligibility
-- description for a property, then backfills it for the 42 LSS properties matched to
-- existing LEAP records from the Lutheran Social Services property roster.
-- The column is net-new; no existing property carried a marketing description, so this
-- is fully additive (no existing data overwritten).

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_marketing_description text;

COMMENT ON COLUMN public.properties.property_marketing_description IS
  'Owner-provided public-facing marketing and tenant-eligibility description for the property (e.g. unit mix, age/disability preferences, income restrictions). Distinct from internal property_notes.';

UPDATE public.properties AS p
SET property_marketing_description = v.descr,
    property_updated_at = now()
FROM (VALUES
  ('3d074184-8b09-42b7-b39f-94d9df85db46'::uuid, 'This 32-unit property features one-bedroom units. Eligibility requires that the head of household be at least 62 years of age, or have a qualifying physical disability, as defined by HUD, and meet all applicable income restrictions.'),
  ('424b9fc2-ba09-4947-863c-2f4d1c02a4df'::uuid, 'This 24-unit property offers one-bedroom units. The head of household must be at least 62 years of age and must meet income restrictions.'),
  ('a10d60fc-8a92-4237-87fb-9bc0e67b5207'::uuid, 'This 7-unit property features two-bedroom units. Eligibility requires that the head of household have a qualifying developmental disability, as defined by HUD, and must meet all applicable income restrictions.'),
  ('e7b8aff3-94db-401a-846c-392ac6a0d39d'::uuid, 'This 49-unit Section 42/Tax Credit affordable community offers studio, 1-bedroom, and 2-bedroom homes. Featuring tall ceilings, beautiful original woodwork, and an abundance of natural light, this restored historic schoolhouse is sure to impress.'),
  ('c9b60474-81ab-48d9-907f-36e9b3945036'::uuid, 'This 11-unit property features one- and two-bedroom units. Eligibility requires that the head of household have a qualifying chronic mental illness, as defined by HUD, and meet all applicable income restrictions.'),
  ('2f247aaf-5bf1-47ea-ad22-b52c0d060623'::uuid, 'Our 45-unit community features well-designed two- and three-bedroom apartments. Residency is limited to households that qualify under Section 42 guidelines. For eligibility details and more information, visit our property website.'),
  ('b679fc08-1bfc-40b7-97e8-16babdde8e3a'::uuid, 'NOW LEASING!
Bronzeville Apartments is a newly constructed community featuring quality 1-, 2-, 3-, and 4-bedroom apartment homes at affordable rates. Income restrictions apply for select units. Visit the property website for additional details and to submit your application today.'),
  ('97f5e37e-8b5d-4138-9305-dfe4f2565951'::uuid, 'This 6-unit property features two-bedroom units. Eligibility requires that the head of household have a qualifying developmental disability, as required by HUD, and meet all applicable income restrictions.'),
  ('9160711d-9388-4512-9fd9-c21f80ebc358'::uuid, 'Welcome home to Collective on 4th — a 62-unit Section 42/Tax Credit community offering both affordable and market-rate apartment homes. Enjoy convenient amenities including a fitness center, garage parking, a community room, and more. Visit our website for additional details and to submit your application today.'),
  ('b8d3b887-816f-4b2b-b95e-89c014164236'::uuid, 'This 25-unit property features studio and one-bedroom units. Eligibility requires that the head of household be at least 62 years of age or have a qualifying physical disability, as defined by HUD, and meet all applicable income restrictions.'),
  ('e0c951bd-31f7-41ad-af25-3ab5d327bc00'::uuid, 'Countryside Estates – Clintonville is an 8-unit, HUD-subsidized community designed to support residents with specialized housing needs. Eligible households include those in which the head of household has a developmental disability, as defined by HUD, and meets HUD’s extremely low-income limits.'),
  ('8150db0c-c6c1-4c6d-a730-16dc57454451'::uuid, 'Countryside Estates – Waupaca is an 8-unit, HUD-subsidized community designed to support residents with specialized housing needs. Eligible households include those in which the head of household has a developmental disability, as defined by HUD, and meets HUD’s extremely low-income limits.'),
  ('350df1e8-38d8-416a-b0f7-afaafc9cabe5'::uuid, 'Newly renovated! Studio Apartments, on-site property management, supportive services on-site. Units available for persons experiencing or at risk of homelessness. On-site laundry, exercise room, library, community room, and patio areas, off-street parking, All utilities included.'),
  ('88e908c5-4519-4f62-8e8b-39eca264a185'::uuid, 'This 11-unit property features one- and two-bedroom units. Eligibility requires that the head of household have a qualifying chronic mental illness, as defined by HUD, and meet all applicable income restrictions.'),
  ('fb9731c4-9da7-432d-b37a-754b18bba2a7'::uuid, 'Forest Towers is a 6-unit, HUD-subsidized community offering comfortable 1- and 2-bedroom apartment homes. Eligible households include those in which the head of household has a chronic mental illness, as defined by HUD, and meets HUD’s very low-income limits.'),
  ('0d2f7b60-5a5d-4652-b304-05983c0cb143'::uuid, 'This 33-unit property offers one-bedroom units. The head of household must be at least 62 years of age and must meet income restrictions.'),
  ('b543991e-c88e-43f3-9da2-52547645636c'::uuid, 'This 8-unit property features one- and two-bedroom units. Eligibility requires that the head of household have a qualifying developmental disability, as required by HUD, and meet all applicable income restrictions.'),
  ('4e1e2b9a-23cd-4e2d-9a13-8956b0fdaf42'::uuid, 'Green Valley Estates – Clark St is a HUD-subsidized community offering comfortable 1-bedroom apartment homes. Eligible households include those in which the head of household has a developmental disability or is age 62+ and meets HUD’s extremely low-income limits.'),
  ('8ec733bc-29a3-4d39-b122-61c7090720be'::uuid, 'Green Valley Estates – Hillview Dr is a HUD-subsidized community offering comfortable 1-bedroom apartment homes. Eligible households include those in which the head of household has a developmental disability or age 62+ and meets HUD’s extremely low-income limits.'),
  ('1df415fb-28bf-40c4-b342-635737bf37ab'::uuid, 'This 8-unit property features one- and two-bedroom units. Eligibility requires that the head of household have a qualifying developmental disability, as required by HUD, and meet all applicable income restrictions.'),
  ('c4d38418-e438-4b02-9696-0fbb62a792d1'::uuid, 'Welcome home to Hickory Flats, an 8-unit HUD-subsidized community offering comfortable 1-bedroom apartment homes.
Eligible households include those in which the head of household has a developmental disability or a physical disability, as defined by HUD, and meet HUD’s extremely low-income limits.'),
  ('fbac6b11-d533-44ad-b15f-ee799d8fb433'::uuid, 'This 48-unit property offers one-bedroom units. The head of household must be at least 62 years of age and must meet income restrictions.'),
  ('d2e442b2-5eed-4ba7-b2d2-7a08d5ca5cba'::uuid, 'This 8-unit building features one-bedroom apartments. Eligibility requires that the head of household have a qualifying developmental disability, as defined by HUD, and meet all applicable HUD income limits.'),
  ('751b9d21-54f4-4c40-a020-7815f21ed1a6'::uuid, 'Manitowoc Shores – 39th Street is an 8 unit HUD-subsidized community offering 1- and 2-bedroom apartment homes. Eligible households include those in which the head of household has a developmental disability, as defined by HUD, and meets HUD’s extremely low-income limits.'),
  ('37c62dee-fa03-4c56-b4d6-0c6dc1e058c3'::uuid, 'Manitowoc Shores – Mary Street is an 8 unit HUD-subsidized community offering 1- and 2-bedroom apartment homes. Eligible households include those in which the head of household has a developmental disability, as defined by HUD, and meets HUD’s extremely low-income limits.'),
  ('268c0432-609d-4525-9d49-efed1cf22572'::uuid, 'This 8-unit property features one- and two-bedroom units. Eligibility requires that the head of household have a qualifying developmental disability, as defined by HUD, and meet all applicable income restrictions.'),
  ('df7ff4e5-d334-4011-a8b9-0097ee27d74b'::uuid, 'This 16-unit property features one- and two-bedroom units. Eligibility requires that the head of household have a qualifying physical disability, as defined by HUD, and meet all applicable HUD income limits.'),
  ('eea22231-70db-4c1c-8c68-a86b439f7a05'::uuid, 'This 12-unit property offers one- and two-bedroom apartments. The head of household must have a qualifying physical disability, as defined by HUD, and must meet HUD income eligibility requirements.'),
  ('1e85b56a-732a-4c90-9530-842c1a8fc387'::uuid, 'This 11-unit property features one- and two-bedroom units. Eligibility requires that the head of household have a qualifying chronic mental illness, as defined by HUD, and meet all applicable income restrictions.'),
  ('684ebb43-a88a-43d7-875c-e91eca0061d8'::uuid, 'This 15-unit property features one-bedroom units. Eligibility requires that the head of household have a qualifying chronic mental illness, as defined by HUD, and meet all applicable income restrictions.'),
  ('af20224c-0371-41d7-ab9b-2614a66c5c2e'::uuid, 'This 11-unit property features one- and two-bedroom units. Eligibility requires that the head of household have a qualifying chronic mental illness, as defined by HUD, and meet all applicable income restrictions.'),
  ('f9cf836f-a324-4956-8aab-a86c2bdf5724'::uuid, 'Silver Spring Square Apartments is a Section 42/Section 8 affordable housing community offering comfortable 2-bedroom apartment homes. Residents enjoy convenient amenities including a community room and off-street parking.'),
  ('36edc147-fc76-4414-bbd2-96b24ceaa939'::uuid, 'This 10-unit property features one-bedroom units. Eligibility requires that the head of household have a qualifying chronic mental illness, as defined by HUD, and meet all applicable HUD income limits.'),
  ('8da60ea4-1b2f-4fc0-b808-15abe97ffa45'::uuid, 'This 11-unit property offers one- and two-bedroom apartments. The head of household must have a qualifying chronic mental illness, as defined by HUD, and must meet applicable income restrictions.'),
  ('e986aa04-f701-477f-8187-acfd4cdd0974'::uuid, 'Welcome to Thirteen31 Place Apartments, a Section 42/Tax Credit affordable community offering modern living at an exceptional value. Choose from spacious 1-, 2-, and 3-bedroom homes, thoughtfully designed for comfort and convenience.'),
  ('82163d68-6b6f-4144-b937-05fc6530ac61'::uuid, 'Welcome to Trolley Station Terrace, a Section 42/Tax Credit affordable community designed for comfort, convenience, and modern living. Choose from spacious 1-, 2-, and 3-bedroom homes—each crafted to feel like the perfect place to call home.'),
  ('2cb612ff-db87-40c1-ae4c-6f0dee7f0f48'::uuid, 'Welcome to this 40 unit property, featuring 2 bedroom units.  Income restrictions apply.'),
  ('1ed7a8af-2486-49e7-bc49-2df92a9c9246'::uuid, 'Willo is a 13-unit, HUD-subsidized community offering comfortable 2-bedroom apartment homes. Eligible households include those in which the head of household has a physical disability, as defined by HUD, and meets HUD’s extremely low-income limits.'),
  ('96971f21-5bca-493f-9a7b-38769f82df65'::uuid, 'Willow Wood is a HUD-subsidized, 8-unit community designed to support individuals with specialized housing needs. Eligible households include those in which the head of household has a chronic mental illness, as defined by HUD, and who meet the extremely low-income limits established by HUD.  Apply today by clicking below.'),
  ('d4b90054-98fa-408e-8e01-3cb01e283c93'::uuid, 'Woodside Apartments is a 12-unit, HUD-subsidized community offering comfortable 1- and 2-bedroom homes. Eligible households include those in which the head of household is developmentally disabled and whose income falls within HUD’s extremely low-income limits.'),
  ('0dcb8abc-b9b3-4d24-b592-c04262aab0bd'::uuid, 'This HUD-subsidized 12-unit property offers one- and two-bedroom apartments. The head of household must have a qualifying developmental disability, as defined by HUD, and meet HUD income eligibility requirements.'),
  ('af7cb029-2c71-45bc-b0b3-d5ac52a4d923'::uuid, 'Revival Ridge Apartments offers 49 high-quality, affordable homes under the Section 42/Tax Credit program. In partnership with the CDA, 36 of these units feature Project-Based Vouchers (PBV), making them even more accessible for qualifying households.')
) AS v(id, descr)
WHERE p.id = v.id
  AND p.property_is_deleted IS NOT TRUE
  AND p.property_marketing_description IS DISTINCT FROM v.descr;
