-- Add a structured Property Management Company lookup on properties, mirroring the
-- owner lookup (property_account_id -> accounts). Backfills from the loose HUD
-- management-org text already on each row, creating one management-company account
-- per distinct org (deduped against existing accounts by case-insensitive name).
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS property_management_company_id uuid REFERENCES accounts(id);

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
    AND lower(trim(ax.account_name)) = lower(d.org)
);

UPDATE properties p
SET property_management_company_id = (
      SELECT ax.id FROM accounts ax
      WHERE ax.account_is_deleted=false
        AND lower(trim(ax.account_name)) = lower(trim(p.property_hud_management_org))
      ORDER BY ax.account_created_at NULLS LAST
      LIMIT 1
    ),
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
WHERE p.property_is_deleted=false
  AND p.property_hud_management_org IS NOT NULL
  AND trim(p.property_hud_management_org) <> ''
  AND p.property_management_company_id IS NULL;
