-- =============================================================================
-- Opportunity Stage Ladders — completeness + cleanup
--
-- Follow-up to 20260727005838 (stage chevron rebind). That migration bound the
-- opportunity chevron to opportunity_stage; this one makes the underlying
-- per-record-type stage ladders correct and complete so the chevron renders on
-- every IRA program.
--
-- Every opportunity record type keeps its OWN unique, never-shared stage
-- picklist values (scoped via picklist_value_record_type_assignments). No stage
-- value is shared across record types.
--
-- PART 1 — NC-IRA-MF-HOMES-AUDIT ladder repair:
--   Its ladder had duplicate + colliding assignments (WI/MI stages assigned
--   into NC, plus a stray "Property Identified"), and its own Income
--   Qualification stage was never scoped — so the 25 opps sitting on it, and 2
--   on a legacy "Outreach Active", fell off the chevron.
--
-- PART 2 — Author the standard IRA ladders for the 8 delivery record types and
--   2 SF-audit record types that had no ladder at all.
--
-- NOT built here: FOE-2024/2025/2026-WI. Focus on Energy is a distinct
-- Trade-Ally program with its own milestones that are not defined in the
-- project-lifecycle doc; its stage list needs Nicholas's input rather than a
-- guess. Their chevrons self-suppress (no stages) until then.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART 1 — NC-IRA-MF-HOMES-AUDIT ladder repair
-- ---------------------------------------------------------------------------

-- 1a. Scope the native NC HOMES Audit Income Qualification stage (25 opps
--     already sit on it) and restore it to the path.
UPDATE picklist_values SET picklist_show_in_path = true
WHERE id = 'a25ab60a-7eae-460a-9d36-4937f566c8b9';

INSERT INTO picklist_value_record_type_assignments
  (pvrta_record_number, pvrta_picklist_value_id, pvrta_record_type_id, pvrta_sort_order, pvrta_is_deleted)
SELECT '', 'a25ab60a-7eae-460a-9d36-4937f566c8b9', rtv.id, 1, false
FROM picklist_values rtv
WHERE rtv.picklist_object='opportunities' AND rtv.picklist_field='record_type'
  AND rtv.picklist_value='nc_ira_mf_homes_audit'
  AND NOT EXISTS (
    SELECT 1 FROM picklist_value_record_type_assignments a
    WHERE a.pvrta_picklist_value_id='a25ab60a-7eae-460a-9d36-4937f566c8b9'
      AND a.pvrta_record_type_id=rtv.id AND a.pvrta_is_deleted=false);

-- 1b. Remove the stray + cross-program (shared) stage assignments from NC audit.
UPDATE picklist_value_record_type_assignments a
SET pvrta_is_deleted=true, pvrta_deleted_at=now(),
    pvrta_deletion_reason='Opportunity stage chevron cleanup: NC-IRA-MF-HOMES-AUDIT ladder deduped; stray/cross-program assignment removed so no stage is shared across record types.'
FROM picklist_values rtv
WHERE a.pvrta_record_type_id=rtv.id
  AND rtv.picklist_object='opportunities' AND rtv.picklist_field='record_type'
  AND rtv.picklist_value='nc_ira_mf_homes_audit'
  AND a.pvrta_is_deleted=false
  AND a.pvrta_picklist_value_id IN (
    '260434c8-36fc-4022-87e1-c32a5aa8a304', -- "Property Identified" (stray, unused)
    '0d072f8e-3d20-4052-a91c-2e28d064914b', -- WI HOMES Audit Income Qualification (belongs to WI)
    '913be92c-5974-4432-9af0-b53a43251c0a', -- WI HOMES Audit Energy Assessment  (belongs to WI)
    'cdf37ff2-31a4-4a74-bc93-dea25616b768'  -- MI HOMES Audit Project Reservation (belongs to MI)
  );

-- 1c. Repoint the 2 legacy "Outreach Active" NC-audit opps to the scoped
--     Income Qualification stage (start of the ladder).
UPDATE opportunities
SET opportunity_stage='a25ab60a-7eae-460a-9d36-4937f566c8b9'
WHERE opportunity_is_deleted IS NOT TRUE
  AND opportunity_stage='052c18a5-a666-4192-9380-21e17362af62'
  AND opportunity_record_type=(SELECT id FROM picklist_values
        WHERE picklist_object='opportunities' AND picklist_field='record_type'
          AND picklist_value='nc_ira_mf_homes_audit');

-- ---------------------------------------------------------------------------
-- PART 2a — IRA delivery ladder (10 stages) for HOMES/HEAR delivery types.
--   Value encodes state+segment+program+phase (globally unique); label carries
--   only the program flavor, matching the existing HOMES/HEAR ladders.
-- ---------------------------------------------------------------------------
WITH rt(rt_value, tok, prog) AS (VALUES
    ('nc_ira_mf_homes','NC MF HOMES','HOMES'),
    ('mi_ira_mf_homes','MI MF HOMES','HOMES'),
    ('wi_ira_sf_homes','WI SF HOMES','HOMES'),
    ('nc_ira_sf_homes','NC SF HOMES','HOMES'),
    ('mi_ira_sf_homes','MI SF HOMES','HOMES'),
    ('wi_ira_sf_hear','WI SF HEAR','HEAR'),
    ('nc_ira_sf_hear','NC SF HEAR','HEAR'),
    ('mi_ira_sf_hear','MI SF HEAR','HEAR')),
  stg(n, nm) AS (VALUES
    (1,'Income Qualification'),(2,'Energy Assessment'),(3,'Energy Modeling'),
    (4,'Project Reservation'),(5,'Project Planning'),(6,'Project Implementation'),
    (7,'Commissioning & Verification'),(8,'Payment Request Submitted'),
    (9,'Final Inspection'),(10,'Payment Issued'))
INSERT INTO picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_sort_order, picklist_is_active, picklist_show_in_path)
SELECT 'opportunities','opportunity_stage',
       'Opportunity — '||rt.tok||' Phase '||stg.n||': '||stg.nm,
       'Opportunity — '||rt.prog||' '||stg.nm,
       stg.n, true, true
FROM rt CROSS JOIN stg
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values pv
  WHERE pv.picklist_object='opportunities' AND pv.picklist_field='opportunity_stage'
    AND pv.picklist_value='Opportunity — '||rt.tok||' Phase '||stg.n||': '||stg.nm);

WITH rt(rt_value, tok, prog) AS (VALUES
    ('nc_ira_mf_homes','NC MF HOMES','HOMES'),
    ('mi_ira_mf_homes','MI MF HOMES','HOMES'),
    ('wi_ira_sf_homes','WI SF HOMES','HOMES'),
    ('nc_ira_sf_homes','NC SF HOMES','HOMES'),
    ('mi_ira_sf_homes','MI SF HOMES','HOMES'),
    ('wi_ira_sf_hear','WI SF HEAR','HEAR'),
    ('nc_ira_sf_hear','NC SF HEAR','HEAR'),
    ('mi_ira_sf_hear','MI SF HEAR','HEAR')),
  stg(n, nm) AS (VALUES
    (1,'Income Qualification'),(2,'Energy Assessment'),(3,'Energy Modeling'),
    (4,'Project Reservation'),(5,'Project Planning'),(6,'Project Implementation'),
    (7,'Commissioning & Verification'),(8,'Payment Request Submitted'),
    (9,'Final Inspection'),(10,'Payment Issued'))
INSERT INTO picklist_value_record_type_assignments
  (pvrta_record_number, pvrta_picklist_value_id, pvrta_record_type_id, pvrta_sort_order, pvrta_is_deleted)
SELECT '', sv.id, rtv.id, stg.n, false
FROM rt CROSS JOIN stg
JOIN picklist_values sv ON sv.picklist_object='opportunities' AND sv.picklist_field='opportunity_stage'
  AND sv.picklist_value='Opportunity — '||rt.tok||' Phase '||stg.n||': '||stg.nm
JOIN picklist_values rtv ON rtv.picklist_object='opportunities' AND rtv.picklist_field='record_type'
  AND rtv.picklist_value=rt.rt_value
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_value_record_type_assignments a
  WHERE a.pvrta_picklist_value_id=sv.id AND a.pvrta_record_type_id=rtv.id AND a.pvrta_is_deleted=false);

-- ---------------------------------------------------------------------------
-- PART 2b — SF audit sales ladder (7 stages), mirroring NC-IRA-SF-HOMES-AUDIT.
-- ---------------------------------------------------------------------------
WITH rt(rt_value, tok) AS (VALUES
    ('wi_ira_sf_homes_audit','WI SF HOMES Audit'),
    ('mi_ira_sf_homes_audit','MI SF HOMES Audit')),
  stg(n, nm) AS (VALUES
    (1,'Site Visit To Be Scheduled'),(2,'Site Visit Scheduled'),
    (3,'Assessment Completed'),(4,'Scope & Pricing'),(5,'Proposal Sent'),
    (6,'Enrolled'),(7,'Closed Lost'))
INSERT INTO picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_sort_order, picklist_is_active, picklist_show_in_path)
SELECT 'opportunities','opportunity_stage',
       'Opportunity — '||rt.tok||': '||stg.nm, stg.nm, stg.n, true, true
FROM rt CROSS JOIN stg
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values pv
  WHERE pv.picklist_object='opportunities' AND pv.picklist_field='opportunity_stage'
    AND pv.picklist_value='Opportunity — '||rt.tok||': '||stg.nm);

WITH rt(rt_value, tok) AS (VALUES
    ('wi_ira_sf_homes_audit','WI SF HOMES Audit'),
    ('mi_ira_sf_homes_audit','MI SF HOMES Audit')),
  stg(n, nm) AS (VALUES
    (1,'Site Visit To Be Scheduled'),(2,'Site Visit Scheduled'),
    (3,'Assessment Completed'),(4,'Scope & Pricing'),(5,'Proposal Sent'),
    (6,'Enrolled'),(7,'Closed Lost'))
INSERT INTO picklist_value_record_type_assignments
  (pvrta_record_number, pvrta_picklist_value_id, pvrta_record_type_id, pvrta_sort_order, pvrta_is_deleted)
SELECT '', sv.id, rtv.id, stg.n, false
FROM rt CROSS JOIN stg
JOIN picklist_values sv ON sv.picklist_object='opportunities' AND sv.picklist_field='opportunity_stage'
  AND sv.picklist_value='Opportunity — '||rt.tok||': '||stg.nm
JOIN picklist_values rtv ON rtv.picklist_object='opportunities' AND rtv.picklist_field='record_type'
  AND rtv.picklist_value=rt.rt_value
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_value_record_type_assignments a
  WHERE a.pvrta_picklist_value_id=sv.id AND a.pvrta_record_type_id=rtv.id AND a.pvrta_is_deleted=false);

-- ---------------------------------------------------------------------------
-- PART 3 — Drop any now-unscoped opportunity_stage value from the path.
--   Unassigning "Property Identified" from NC audit above left it with zero
--   record-type assignments; an unscoped value is "universal" and would leak
--   onto every ladder. Re-run the hide rule to catch it (and any future case).
-- ---------------------------------------------------------------------------
UPDATE picklist_values pv
SET picklist_show_in_path = false
WHERE pv.picklist_object='opportunities' AND pv.picklist_field='opportunity_stage'
  AND COALESCE(pv.picklist_show_in_path, true) = true
  AND NOT EXISTS (
        SELECT 1 FROM picklist_value_record_type_assignments a
        WHERE a.pvrta_picklist_value_id = pv.id AND a.pvrta_is_deleted = false);
