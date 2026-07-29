-- Contact layout cleanup: Contact Role off the record, Inactive -> System (admin-only)
-- ---------------------------------------------------------------------------
-- Nicholas, 2026-07-29:
--  (1) A contact record should NOT carry a "Contact Role" field. A person's
--      role is per-opportunity — the SAME contact can be the Decision Maker on
--      one opportunity, a plain contact on another, and uninvolved on a third.
--      That already lives in the Opportunity Contact Roles related list (present
--      on every contact layout). Remove the stray contact_role picklist field
--      from the Contact Information field group so it stops showing on create.
--  (2) The "Inactive" toggle belongs in System Information, not the main create
--      form, and only a System Administrator should be able to set it — regular
--      users can see whether a contact is inactive but not change it. New
--      contacts are active by default (the column already defaults to false).
--
-- All changes are additive/idempotent and target the contact layouts by content
-- (not hard-coded widget ids), so a branch-database replay off the baseline
-- lands them on the same widgets.
-- ---------------------------------------------------------------------------

-- 1) Drop contact_role from every contact field group that still carries it.
UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config, '{fields}',
      (SELECT COALESCE(jsonb_agg(f), '[]'::jsonb)
         FROM jsonb_array_elements(w.widget_config->'fields') f
        WHERE f->>'name' <> 'contact_role'))
FROM public.page_layout_sections s, public.page_layouts pl
WHERE w.section_id = s.id AND s.page_layout_id = pl.id
  AND pl.page_layout_object = 'contacts' AND pl.is_deleted = false
  AND w.widget_type = 'field_group' AND w.is_deleted = false
  AND w.widget_config->'fields' @> '[{"name":"contact_role"}]'::jsonb;

-- 2) Remove contact_inactive from any NON-System-Information contact field group
--    (today: the "Contact Information" group on the default Contact Layout).
UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config, '{fields}',
      (SELECT COALESCE(jsonb_agg(f), '[]'::jsonb)
         FROM jsonb_array_elements(w.widget_config->'fields') f
        WHERE f->>'name' <> 'contact_inactive'))
FROM public.page_layout_sections s, public.page_layouts pl
WHERE w.section_id = s.id AND s.page_layout_id = pl.id
  AND pl.page_layout_object = 'contacts' AND pl.is_deleted = false
  AND w.widget_type = 'field_group' AND w.is_deleted = false
  AND COALESCE(w.widget_title, '') <> 'System Information'
  AND w.widget_config->'fields' @> '[{"name":"contact_inactive"}]'::jsonb;

-- 3) Add contact_inactive to the top of every contact "System Information"
--    field group that does not already have it.
UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config, '{fields}',
      '[{"name":"contact_inactive","type":"boolean","label":"Inactive","column":1}]'::jsonb
        || (w.widget_config->'fields'))
FROM public.page_layout_sections s, public.page_layouts pl
WHERE w.section_id = s.id AND s.page_layout_id = pl.id
  AND pl.page_layout_object = 'contacts' AND pl.is_deleted = false
  AND w.widget_type = 'field_group' AND w.is_deleted = false
  AND COALESCE(w.widget_title, '') = 'System Information'
  AND NOT (w.widget_config->'fields' @> '[{"name":"contact_inactive"}]'::jsonb);

-- 4) Normalize existing null Inactive values to false (active) so the field
--    reads consistently. The column already defaults to false for new rows.
UPDATE public.contacts SET contact_inactive = false WHERE contact_inactive IS NULL;

-- 5) Field-level security: contact_inactive is visible to everyone but editable
--    only by Admin. Insert a visible+non-editable row for every non-Admin role
--    (app_user_field_permissions short-circuits Admin to fully editable).
INSERT INTO public.field_permissions (id, fp_object, fp_field, fp_role_id, fp_visible, fp_editable)
SELECT gen_random_uuid(), 'contacts', 'contact_inactive', r.id, true, false
FROM public.roles r
WHERE r.role_name <> 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.field_permissions fp
     WHERE fp.fp_object = 'contacts' AND fp.fp_field = 'contact_inactive'
       AND fp.fp_role_id = r.id);

NOTIFY pgrst, 'reload schema';
