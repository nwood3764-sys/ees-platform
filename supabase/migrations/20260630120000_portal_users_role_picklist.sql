-- =============================================================================
-- Portal Users — convert portal_role from free text to a data-driven picklist
--
-- portal_role was a plain text column, so the record form rendered it as a text
-- box (no validation, anything typeable). LEAP renders a field as a dropdown
-- only when it is a uuid FK to picklist_values, so this converts portal_role to
-- that standard pattern and seeds the two roles:
--   Property Administrator — full access (view, upload, e-sign, send)
--   Property Viewer        — read-only
-- Any existing text value is migrated into the matching picklist reference
-- before the old column is dropped (no data lost); unmatched rows default to the
-- least-privilege Property Viewer.
-- =============================================================================

-- 1. Seed the two portal roles (idempotent)
INSERT INTO picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order, picklist_is_active)
SELECT v.o, v.f, v.val, v.lbl, v.so, true
FROM (VALUES
  ('portal_users','portal_role','property_administrator','Property Administrator',1),
  ('portal_users','portal_role','property_viewer','Property Viewer',2)
) AS v(o,f,val,lbl,so)
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values p
  WHERE p.picklist_object='portal_users' AND p.picklist_field='portal_role' AND p.picklist_value=v.val
);

-- 2. Convert the column text -> uuid FK to picklist_values
ALTER TABLE portal_users ADD COLUMN portal_role_uuid uuid;

UPDATE portal_users pu SET portal_role_uuid = pv.id
FROM picklist_values pv
WHERE pv.picklist_object='portal_users' AND pv.picklist_field='portal_role'
  AND lower(btrim(pu.portal_role)) IN (lower(pv.picklist_label), lower(pv.picklist_value));

-- Anything that didn't map (legacy/free-typed) -> least privilege
UPDATE portal_users SET portal_role_uuid = (
  SELECT id FROM picklist_values
  WHERE picklist_object='portal_users' AND picklist_field='portal_role' AND picklist_value='property_viewer')
WHERE portal_role_uuid IS NULL;

ALTER TABLE portal_users DROP COLUMN portal_role;
ALTER TABLE portal_users RENAME COLUMN portal_role_uuid TO portal_role;
ALTER TABLE portal_users ALTER COLUMN portal_role SET NOT NULL;
ALTER TABLE portal_users
  ADD CONSTRAINT portal_users_portal_role_fkey FOREIGN KEY (portal_role) REFERENCES picklist_values(id);

NOTIFY pgrst, 'reload schema';
