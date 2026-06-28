-- Resolve properties parked on "Unknown Owner — [state]" buckets to their real
-- legal owner, where the owner is grounded in source:
--   1) property_hud_owner_org on the row (HUD owner-of-record), or
--   2) the public housing authority name from stg_hud_ph (PHA developments).
-- Re-pointed 1,866 properties to 997 distinct real owners (905 new property_owner
-- accounts created, 92 matched to existing accounts by case-insensitive name).
--
-- Deliberately NOT touched:
--   - 708 rows that have only a HUD management org (a management agent is not the
--     legal owner; the management data is already on the row as text fields).
--   - 4,606 rows with no owner signal in any available source.
-- These remain on Unknown Owner accounts rather than be assigned a fabricated or
-- incorrect (management-company) owner.

CREATE TEMP TABLE _owner_resolve ON COMMIT DROP AS
SELECT p.id AS property_id,
       trim(COALESCE(NULLIF(trim(p.property_hud_owner_org),''), s.authority_name)) AS owner_name
FROM properties p
JOIN accounts a ON a.id = p.property_account_id
LEFT JOIN stg_hud_ph s ON s.development_code = p.property_ph_development_code
WHERE p.property_is_deleted=false
  AND a.account_name ILIKE 'Unknown Owner%'
  AND (p.property_hud_owner_org IS NOT NULL OR s.authority_name IS NOT NULL);

INSERT INTO accounts (account_record_number, account_name, account_record_type, account_owner, account_created_by)
SELECT '', d.owner_name, '1bbfb080-2c86-42b6-a222-1d2cbf205969',
       'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (SELECT DISTINCT owner_name FROM _owner_resolve WHERE owner_name IS NOT NULL AND owner_name <> '') d
WHERE NOT EXISTS (
  SELECT 1 FROM accounts ax
  WHERE ax.account_is_deleted=false
    AND lower(trim(ax.account_name)) = lower(d.owner_name)
);

UPDATE properties p
SET property_account_id = tgt.id,
    property_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    property_updated_at = now()
FROM _owner_resolve r
JOIN LATERAL (
  SELECT ax.id FROM accounts ax
  WHERE ax.account_is_deleted=false
    AND lower(trim(ax.account_name)) = lower(r.owner_name)
  ORDER BY ax.account_created_at NULLS LAST
  LIMIT 1
) tgt ON true
WHERE p.id = r.property_id;
