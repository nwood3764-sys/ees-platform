-- North Carolina single-family + multifamily self-scheduling auditor resources.
--
-- Context: the customer self-scheduling engine (compute-availability) matches a
-- booking to qualifying field resources by SKILL within the address's service
-- territory. Wisconsin and Michigan already have a "<State> Single Family
-- Auditor" (BPI Building Analyst) and a "<State> Multi-Family Auditor"
-- (BPI Multifamily Building Analyst) wired into their territories. North
-- Carolina's territory was fully provisioned (operating hours + Charlotte-metro/
-- Piedmont ZIP coverage) but the NC Single/Multi-Family auditor contacts were
-- never added to the North Carolina service territory and were homed at the NC
-- state centroid (Raleigh) instead of the actual Charlotte-metro service area.
-- With the territory's 120-minute one-way drive cap, a Raleigh home base does
-- not cover the Charlotte ZIPs, so NC single-family and multifamily
-- self-scheduling returned "no qualifying resources" / "no availability".
--
-- This migration makes NC match the WI/MI setup, fully idempotent so it repairs
-- an environment where the auditor contacts already exist (created without
-- territory membership / at the wrong home base) as well as a fresh database:
--   1. create the NC Single/Multi-Family auditor contacts if missing;
--   2. ensure their home base is Huntersville (Charlotte metro), matching the
--      generic NC auditor and the serviceable ZIPs;
--   3. ensure each carries the correct skill (SF: BPI Building Analyst,
--      MF: BPI Multifamily Building Analyst);
--   4. ensure each is a member of the North Carolina service territory.
--
-- Operating hours and ZIP coverage already exist on the North Carolina
-- territory and are unchanged. Territory membership is inserted set-based
-- (INSERT ... SELECT), which the stm record-number BEFORE trigger populates
-- reliably.

DO $$
DECLARE
  v_owner     uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';   -- system owner used by the WI/MI auditors
  v_account   uuid := '57069b08-3969-4669-996b-31483c754610';   -- EES internal account carrying the auditor resources
  v_rectype   uuid := 'c040ba82-76ac-4025-a04d-9dd8d540b6a0';   -- contact record type used by the WI/MI auditors
BEGIN
  -- 1. Create the auditor contacts if they do not already exist.
  IF NOT EXISTS (SELECT 1 FROM contacts
                 WHERE contact_name = 'North Carolina Multi-Family Auditor'
                   AND contact_is_deleted IS NOT TRUE) THEN
    INSERT INTO contacts (
      contact_record_number, contact_name, contact_first_name, contact_last_name,
      contact_record_type, contact_owner, contact_created_by, contact_account_id
    ) VALUES (
      '', 'North Carolina Multi-Family Auditor', 'North Carolina Multi-Family', 'Auditor',
      v_rectype, v_owner, v_owner, v_account
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM contacts
                 WHERE contact_name = 'North Carolina Single Family Auditor'
                   AND contact_is_deleted IS NOT TRUE) THEN
    INSERT INTO contacts (
      contact_record_number, contact_name, contact_first_name, contact_last_name,
      contact_record_type, contact_owner, contact_created_by, contact_account_id
    ) VALUES (
      '', 'North Carolina Single Family Auditor', 'North Carolina Single Family', 'Auditor',
      v_rectype, v_owner, v_owner, v_account
    );
  END IF;
END $$;

-- 2. Ensure the home base is Huntersville (Charlotte metro) so the auditors sit
--    inside the serviceable ZIP area under the 120-minute drive cap.
UPDATE contacts SET
  contact_home_base_street    = 'Downtown Huntersville',
  contact_home_base_city      = 'Huntersville',
  contact_home_base_state     = 'NC',
  contact_home_base_zip       = '28078',
  contact_home_base_latitude  = 35.4107,
  contact_home_base_longitude = -80.8428,
  contact_updated_by          = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
WHERE contact_name IN ('North Carolina Multi-Family Auditor', 'North Carolina Single Family Auditor')
  AND contact_is_deleted IS NOT TRUE
  AND ( contact_home_base_latitude IS DISTINCT FROM 35.4107
     OR contact_home_base_longitude IS DISTINCT FROM -80.8428 );

-- 3. Ensure each auditor carries its required skill.
--    Multi-Family -> BPI Multifamily Building Analyst.
INSERT INTO contact_skills (cs_record_number, contact_id, skill_id, cs_skill_level, cs_owner, cs_created_by)
SELECT '', c.id, '18eba3ca-3f97-4a76-8f24-0e0bd851cfc9', 1,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM contacts c
WHERE c.contact_name = 'North Carolina Multi-Family Auditor'
  AND c.contact_is_deleted IS NOT TRUE
  AND NOT EXISTS (SELECT 1 FROM contact_skills cs
                  WHERE cs.contact_id = c.id
                    AND cs.skill_id = '18eba3ca-3f97-4a76-8f24-0e0bd851cfc9'
                    AND cs.cs_is_deleted IS NOT TRUE);

--    Single-Family -> BPI Building Analyst.
INSERT INTO contact_skills (cs_record_number, contact_id, skill_id, cs_skill_level, cs_owner, cs_created_by)
SELECT '', c.id, 'd906b54d-f18e-45e5-8d36-48a9fa051819', 1,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM contacts c
WHERE c.contact_name = 'North Carolina Single Family Auditor'
  AND c.contact_is_deleted IS NOT TRUE
  AND NOT EXISTS (SELECT 1 FROM contact_skills cs
                  WHERE cs.contact_id = c.id
                    AND cs.skill_id = 'd906b54d-f18e-45e5-8d36-48a9fa051819'
                    AND cs.cs_is_deleted IS NOT TRUE);

-- 4. Ensure each auditor is a member of the North Carolina service territory.
INSERT INTO service_territory_members (stm_record_number, service_territory_id, contact_id, stm_is_primary, stm_owner, stm_created_by)
SELECT '', '007ebf5c-1673-4848-807b-5839fa59f540', c.id, false,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM contacts c
WHERE c.contact_name IN ('North Carolina Multi-Family Auditor', 'North Carolina Single Family Auditor')
  AND c.contact_is_deleted IS NOT TRUE
  AND NOT EXISTS (SELECT 1 FROM service_territory_members m
                  WHERE m.contact_id = c.id
                    AND m.service_territory_id = '007ebf5c-1673-4848-807b-5839fa59f540'
                    AND m.stm_is_deleted IS NOT TRUE);
