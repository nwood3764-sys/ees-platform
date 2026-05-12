-- ============================================================================
-- 20260512191940 field_history_tracking_for_permission_and_scope_tables
--
-- Registers field-history tracking for 18 columns across the permission /
-- scope / portal tables. The audit triggers added in f9fb5ab + b0f0f5d
-- already capture INSERT/UPDATE/DELETE in audit_log; this commit makes
-- column-level before-and-after deltas visible via field_history (which
-- the ActivityTimeline component renders inline on each record's detail
-- page).
--
-- Tables + columns covered:
--   permission_sets                   → ps_name, ps_description, ps_is_active
--   permission_set_object_access      → psoa_read, psoa_create, psoa_update,
--                                       psoa_delete
--   permission_set_field_permissions  → psfp_visible, psfp_editable,
--                                       psfp_financial_tier
--   role_object_access                → roa_read, roa_create, roa_update,
--                                       roa_delete
--   portal_role_assignments           → pra_is_default
--   portals                           → portal_name, portal_url_path,
--                                       portal_is_active
--
-- Deliberately not tracked at column level:
--   user_permission_sets / user_account_scopes / user_program_scopes —
--   these are junction tables where the signal is row presence
--   (INSERT/DELETE), captured by audit_log already. No column changes
--   matter semantically.
-- ============================================================================

INSERT INTO public.field_history_tracked_fields
  (fhtf_table_name, fhtf_column_name, fhtf_is_active, fhtf_description)
VALUES
  ('permission_sets',                    'ps_name',                       true,
    'Permission set name. Renaming an active set changes how admins reference it; track for traceability.'),
  ('permission_sets',                    'ps_description',                true,
    'Permission set description. Useful for understanding intent changes over time.'),
  ('permission_sets',                    'ps_is_active',                  true,
    'Active flag. Toggling this on/off effectively grants or revokes the set''s authority across all assigned users.'),
  ('permission_set_object_access',       'psoa_read',                     true,
    'Read grant on the target object. Flipping this changes which users in the set can see the object''s records.'),
  ('permission_set_object_access',       'psoa_create',                   true,
    'Create grant.'),
  ('permission_set_object_access',       'psoa_update',                   true,
    'Update grant.'),
  ('permission_set_object_access',       'psoa_delete',                   true,
    'Delete grant. High-blast-radius change — always worth a history row.'),
  ('permission_set_field_permissions',   'psfp_visible',                  true,
    'Whether the field is visible in the UI for users in this permission set.'),
  ('permission_set_field_permissions',   'psfp_editable',                 true,
    'Whether the field is editable. Visible but not editable is a common configuration.'),
  ('permission_set_field_permissions',   'psfp_financial_tier',           true,
    'Financial tier (1/2/3). Tier 3 = Admin-only; changing the tier widens/narrows visibility.'),
  ('role_object_access',                 'roa_read',                      true,
    'Role-baseline read grant. Changes affect every user in the role.'),
  ('role_object_access',                 'roa_create',                    true,
    'Role-baseline create grant.'),
  ('role_object_access',                 'roa_update',                    true,
    'Role-baseline update grant.'),
  ('role_object_access',                 'roa_delete',                    true,
    'Role-baseline delete grant.'),
  ('portal_role_assignments',            'pra_is_default',                true,
    'Whether this is the default role for the portal. Only one row per portal should have this true.'),
  ('portals',                            'portal_name',                   true,
    'Portal display name.'),
  ('portals',                            'portal_url_path',               true,
    'URL path portion (e.g. "owner"). Changing this breaks any external bookmarks.'),
  ('portals',                            'portal_is_active',              true,
    'Active flag. Inactive portals shouldn''t serve traffic.')
ON CONFLICT DO NOTHING;
