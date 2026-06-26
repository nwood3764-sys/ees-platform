-- The initial backfill deduped management orgs against ALL accounts by name, so
-- many management FKs landed on Property Owner-typed accounts that share a name
-- but are a different property's owner. Correct the matching rule: a management
-- FK may resolve to (a) this property's own owner account when owner==manager by
-- name (owner self-manages), else (b) a Property Management Company-typed account.
INSERT INTO accounts (account_record_number, account_name, account_record_type, account_owner, account_created_by)
SELECT '', d.org, 'b45d2893-406e-4fd8-844d-e6767172bfed',
       'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (
  SELECT DISTINCT trim(property_hud_management_org) AS org
  FROM properties
  WHERE property_is_deleted=false
    AND property_hud_management_org IS NOT NULL
    AND trim(property_hud_management_org) <> ''
) d
WHERE NOT EXISTS (
  SELECT 1 FROM accounts ax
  WHERE ax.account_is_deleted=false
    AND ax.account_record_type='b45d2893-406e-4fd8-844d-e6767172bfed'
    AND lower(trim(ax.account_name)) = lower(d.org)
);

UPDATE properties p
SET property_management_company_id = COALESCE(
      (SELECT ow.id FROM accounts ow
        WHERE ow.id = p.property_account_id
          AND ow.account_is_deleted=false
          AND lower(trim(ow.account_name)) = lower(trim(p.property_hud_management_org))
        LIMIT 1),
      (SELECT mc.id FROM accounts mc
        WHERE mc.account_is_deleted=false
          AND mc.account_record_type='b45d2893-406e-4fd8-844d-e6767172bfed'
          AND lower(trim(mc.account_name)) = lower(trim(p.property_hud_management_org))
        ORDER BY mc.account_created_at NULLS LAST
        LIMIT 1)
    ),
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
WHERE p.property_is_deleted=false
  AND p.property_hud_management_org IS NOT NULL
  AND trim(p.property_hud_management_org) <> '';
