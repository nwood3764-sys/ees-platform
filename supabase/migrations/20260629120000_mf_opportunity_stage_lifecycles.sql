-- =============================================================================
-- MF Project Portal — opportunity stage lifecycles, per record type
-- -----------------------------------------------------------------------------
-- The Multi-Family Project Portal renders each opportunity's stage bar entirely
-- from the opportunity_stage picklist values ASSIGNED TO ITS RECORD TYPE (via
-- picklist_value_record_type_assignments). The bar is fully data-driven: the
-- number of stages, their labels, and their order all come from the database, so
-- adding or removing a stage in LEAP Admin changes the portal automatically, per
-- record type. Nothing about the count ("10") is hardcoded.
--
-- Reconciliation (see docs/leap-mf-portal-stage-reconciliation.md) found the
-- 10-phase HOMES/HEAR lifecycles existed but were wired only to the data-less
-- WI-IRA-MF base types. The record types the portal actually tracks were not
-- wired:
--   * HOMES object = *-IRA-MF-HOMES-AUDIT  (Nicholas: "the homes audit record
--     type is the object")               -> WI / NC / MI
--   * HEAR object  = *-IRA-MF-HEAR (base) -> NC / MI  (WI-IRA-MF-HEAR already
--     has its 10 stages; left untouched)
--
-- Build discipline: every opportunity record type gets its OWN unique,
-- never-shared opportunity_stage picklist. So each target record type below
-- receives its own 10 picklist_values (unique picklist_value strings) plus 10
-- scoping assignment rows. Display labels intentionally repeat across record
-- types (consistent portal display); only picklist_value is unique.
--
-- Idempotent: NOT EXISTS guards make re-application a no-op.
-- =============================================================================

-- The 10 program phases (label name + sort order). HOMES and HEAR use the same
-- phase names for the MF portal.
WITH phases(n, nm) AS (
  VALUES
    (1,  'Income Qualification'),
    (2,  'Energy Assessment'),
    (3,  'Energy Modeling'),
    (4,  'Project Reservation'),
    (5,  'Project Planning'),
    (6,  'Project Implementation'),
    (7,  'Commissioning & Verification'),
    (8,  'Payment Request Submitted'),
    (9,  'Final Inspection'),
    (10, 'Payment Issued')
),
-- The target record types. `code` makes each value string unique per record
-- type; `prog` drives the (shared) display label.
targets(code, prog, rt_label) AS (
  VALUES
    ('WI HOMES Audit', 'HOMES', 'WI-IRA-MF-HOMES-AUDIT'),
    ('NC HOMES Audit', 'HOMES', 'NC-IRA-MF-HOMES-AUDIT'),
    ('MI HOMES Audit', 'HOMES', 'MI-IRA-MF-HOMES-AUDIT'),
    ('NC HEAR',        'HEAR',  'NC-IRA-MF-HEAR'),
    ('MI HEAR',        'HEAR',  'MI-IRA-MF-HEAR')
)
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order)
SELECT
  'opportunities',
  'opportunity_stage',
  'Opportunity — ' || t.code || ' Phase ' || p.n || ': ' || p.nm,  -- unique value
  'Opportunity — ' || t.prog || ' ' || p.nm,                       -- display label
  true,
  p.n
FROM targets t
CROSS JOIN phases p
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values pv
  WHERE pv.picklist_object = 'opportunities'
    AND pv.picklist_field  = 'opportunity_stage'
    AND pv.picklist_value  = 'Opportunity — ' || t.code || ' Phase ' || p.n || ': ' || p.nm
);

-- Scope each new value to its record type. pvrta_record_number is filled by the
-- trg_pvrta_record_number BEFORE-INSERT trigger; ordering is taken from the
-- value's picklist_sort_order (the RPC orders by sv.picklist_sort_order), but we
-- also set pvrta_sort_order to match for completeness.
WITH phases(n, nm) AS (
  VALUES
    (1,  'Income Qualification'),
    (2,  'Energy Assessment'),
    (3,  'Energy Modeling'),
    (4,  'Project Reservation'),
    (5,  'Project Planning'),
    (6,  'Project Implementation'),
    (7,  'Commissioning & Verification'),
    (8,  'Payment Request Submitted'),
    (9,  'Final Inspection'),
    (10, 'Payment Issued')
),
targets(code, prog, rt_label) AS (
  VALUES
    ('WI HOMES Audit', 'HOMES', 'WI-IRA-MF-HOMES-AUDIT'),
    ('NC HOMES Audit', 'HOMES', 'NC-IRA-MF-HOMES-AUDIT'),
    ('MI HOMES Audit', 'HOMES', 'MI-IRA-MF-HOMES-AUDIT'),
    ('NC HEAR',        'HEAR',  'NC-IRA-MF-HEAR'),
    ('MI HEAR',        'HEAR',  'MI-IRA-MF-HEAR')
)
INSERT INTO public.picklist_value_record_type_assignments
  (pvrta_picklist_value_id, pvrta_record_type_id, pvrta_sort_order)
SELECT pv.id, rt.id, p.n
FROM targets t
CROSS JOIN phases p
JOIN public.picklist_values pv
  ON pv.picklist_object = 'opportunities'
 AND pv.picklist_field  = 'opportunity_stage'
 AND pv.picklist_value  = 'Opportunity — ' || t.code || ' Phase ' || p.n || ': ' || p.nm
JOIN public.picklist_values rt
  ON rt.picklist_object = 'opportunities'
 AND rt.picklist_field  = 'record_type'
 AND rt.picklist_label  = t.rt_label
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_value_record_type_assignments a
  WHERE a.pvrta_picklist_value_id = pv.id
    AND a.pvrta_record_type_id   = rt.id
    AND a.pvrta_is_deleted = false
);

-- Backfill the existing demo opportunities on the HOMES-AUDIT record types from
-- the generic "Property Identified" stage to their record type's new Phase 1
-- (Income Qualification), so they sit inside their own lifecycle.
UPDATE public.opportunities o
SET opportunity_stage = pv.id
FROM public.picklist_values rt
JOIN public.picklist_values pv
  ON pv.picklist_object = 'opportunities'
 AND pv.picklist_field  = 'opportunity_stage'
 AND pv.picklist_sort_order = 1
 AND pv.picklist_value = 'Opportunity — ' || CASE rt.picklist_label
        WHEN 'WI-IRA-MF-HOMES-AUDIT' THEN 'WI HOMES Audit'
        WHEN 'NC-IRA-MF-HOMES-AUDIT' THEN 'NC HOMES Audit'
        WHEN 'MI-IRA-MF-HOMES-AUDIT' THEN 'MI HOMES Audit'
      END || ' Phase 1: Income Qualification'
WHERE o.opportunity_record_type = rt.id
  AND rt.picklist_object = 'opportunities'
  AND rt.picklist_field  = 'record_type'
  AND rt.picklist_label IN ('WI-IRA-MF-HOMES-AUDIT','NC-IRA-MF-HOMES-AUDIT','MI-IRA-MF-HOMES-AUDIT')
  AND o.opportunity_is_deleted = false;

-- Soft-delete any stale opportunity_stage assignment left on the HOMES-AUDIT
-- record types that is NOT part of their new lifecycle (the generic
-- "Property Identified" stage they previously carried), so each record type is
-- left with exactly its own 10-phase set. Soft-delete only (block_hard_delete).
UPDATE public.picklist_value_record_type_assignments a
SET pvrta_is_deleted = true,
    pvrta_deleted_at = now(),
    pvrta_deletion_reason = 'Superseded by MF HOMES Audit 10-phase opportunity_stage lifecycle (stage reconciliation)'
FROM public.picklist_values rt, public.picklist_values pv
WHERE a.pvrta_record_type_id = rt.id
  AND a.pvrta_picklist_value_id = pv.id
  AND rt.picklist_object = 'opportunities' AND rt.picklist_field = 'record_type'
  AND rt.picklist_label IN ('WI-IRA-MF-HOMES-AUDIT','NC-IRA-MF-HOMES-AUDIT','MI-IRA-MF-HOMES-AUDIT')
  AND pv.picklist_object = 'opportunities' AND pv.picklist_field = 'opportunity_stage'
  AND pv.picklist_value NOT LIKE 'Opportunity — % HOMES Audit Phase %'
  AND a.pvrta_is_deleted = false;

-- Reload PostgREST schema cache after picklist changes.
NOTIFY pgrst, 'reload schema';
