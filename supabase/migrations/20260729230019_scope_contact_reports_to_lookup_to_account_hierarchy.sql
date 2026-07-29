-- Scope the contact "Reports To" lookup to the account hierarchy
-- ---------------------------------------------------------------------------
-- Nicholas, 2026-07-29: the Reports To picker on a contact currently lists
-- EVERY contact in the database (Cole Smith / Sealed Inc, Dana Fox / Cedar
-- Point, Dennis Hanson / Lutheran Social Services, ...). It must only offer
-- contacts on THIS contact's account or any of its parent accounts.
--
-- The dependent-lookup kind `contacts_for_account_hierarchy` (RPC
-- list_contacts_for_account_hierarchy) already does exactly this — it walks the
-- account plus every ancestor via parent_account_id. This migration wires the
-- contact_reports_to_id field to it, keyed on the contact's own account
-- (contact_account_id), on every contact page layout that still has the plain,
-- un-scoped Reports To field. Additive and idempotent: it only rewrites the
-- field where the dependency is not already present, and preserves the field's
-- existing column placement.
-- ---------------------------------------------------------------------------

UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config, '{fields}',
      (SELECT jsonb_agg(
         CASE
           WHEN f->>'name' = 'contact_reports_to_id'
           THEN jsonb_build_object(
                  'name',  'contact_reports_to_id',
                  'type',  'lookup',
                  'label', COALESCE(f->>'label', 'Reports To'),
                  'lookup_field', 'contact_name',
                  'lookup_table', 'contacts',
                  'lookup_dependency', jsonb_build_object(
                    'kind', 'contacts_for_account_hierarchy',
                    'depends_on', jsonb_build_array('contact_account_id')
                  )
                )
                || (CASE WHEN f ? 'column'
                         THEN jsonb_build_object('column', f->'column')
                         ELSE '{}'::jsonb END)
           ELSE f
         END)
       FROM jsonb_array_elements(w.widget_config->'fields') f))
FROM public.page_layout_sections s, public.page_layouts pl
WHERE w.section_id = s.id AND s.page_layout_id = pl.id
  AND pl.page_layout_object = 'contacts' AND pl.is_deleted = false
  AND w.widget_type = 'field_group' AND w.is_deleted = false
  AND w.widget_config->'fields' @> '[{"name":"contact_reports_to_id"}]'::jsonb
  AND NOT (w.widget_config->'fields'
           @> '[{"name":"contact_reports_to_id","lookup_dependency":{"kind":"contacts_for_account_hierarchy"}}]'::jsonb);

NOTIFY pgrst, 'reload schema';
