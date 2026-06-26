-- Set NC PHA-import properties to "Section 9 Public Housing".
-- These public-housing developments were imported 2026-06-25 19:45-20:10 linked
-- to housing authority accounts (or the "Unknown Owner — NC" bucket) and are
-- keyed by PH-DEV ids not stored in property_hud_property_id, so they could not
-- match the HUD-id subsidy backfill. Predicate verified to isolate exactly the
-- 1,362 PHA rows (all NC, all null subsidy) with no bleed into other populations.
UPDATE properties p
SET property_subsidy_type = (
      SELECT id FROM picklist_values
      WHERE picklist_object='properties' AND picklist_field='subsidy_type'
        AND picklist_value='Section 9 Public Housing'),
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
FROM accounts a
WHERE a.id = p.property_account_id
  AND p.property_is_deleted = false
  AND p.property_subsidy_type IS NULL
  AND p.property_created_at >= '2026-06-25 19:45:00+00'
  AND p.property_created_at <  '2026-06-25 20:10:00+00'
  AND (a.account_name LIKE '%Housing Authorit%'
       OR a.account_name LIKE '%Regional Housing%'
       OR a.account_name = 'Unknown Owner — NC');
