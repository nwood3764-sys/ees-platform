-- Move ownership_type and ownership_company_structure from properties to
-- accounts. Ownership type is a property of the owning organization, not
-- the property record — putting it on accounts makes it set-once-per-owner
-- and avoids per-property duplication / inconsistency.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_ownership_type uuid,
  ADD COLUMN IF NOT EXISTS account_ownership_company_structure uuid;

INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order, picklist_is_active)
VALUES
  ('accounts', 'ownership_type', 'For-Profit',        'For-Profit',        1, true),
  ('accounts', 'ownership_type', 'Non-Profit',        'Non-Profit',        2, true),
  ('accounts', 'ownership_type', 'Public Housing',    'Public Housing',    3, true),
  ('accounts', 'ownership_type', 'Tribal',            'Tribal',            4, true),
  ('accounts', 'ownership_type', 'Government',        'Government',        5, true),
  ('accounts', 'ownership_type', 'Other',             'Other',             6, true),

  ('accounts', 'ownership_company_structure', 'LLC',                  'LLC',                  1, true),
  ('accounts', 'ownership_company_structure', 'Limited Partnership',  'Limited Partnership',  2, true),
  ('accounts', 'ownership_company_structure', 'Corporation',          'Corporation',          3, true),
  ('accounts', 'ownership_company_structure', 'S-Corp',               'S-Corp',               4, true),
  ('accounts', 'ownership_company_structure', 'Non-Profit Corp',      'Non-Profit Corp',      5, true),
  ('accounts', 'ownership_company_structure', 'Trust',                'Trust',                6, true),
  ('accounts', 'ownership_company_structure', 'Sole Proprietor',      'Sole Proprietor',      7, true),
  ('accounts', 'ownership_company_structure', 'Government Agency',    'Government Agency',    8, true),
  ('accounts', 'ownership_company_structure', 'Tribal Entity',        'Tribal Entity',        9, true),
  ('accounts', 'ownership_company_structure', 'Other',                'Other',               10, true)
ON CONFLICT (picklist_object, picklist_field, picklist_value) DO NOTHING;

-- Remove from every Property page layout (strip the two fields from the
-- fields[] array of any field_group widget that had them).
UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(
     w.widget_config,
     '{fields}',
     (
       SELECT coalesce(jsonb_agg(f), '[]'::jsonb)
       FROM jsonb_array_elements(w.widget_config -> 'fields') AS f
       WHERE f->>'name' NOT IN ('property_ownership_type', 'property_ownership_company_type')
     )
   )
  FROM public.page_layouts pl
 WHERE w.page_layout_id = pl.id
   AND pl.page_layout_object = 'properties'
   AND pl.page_layout_type   = 'record_detail'
   AND NOT pl.is_deleted
   AND NOT w.is_deleted
   AND w.widget_type = 'field_group'
   AND (
     w.widget_config -> 'fields' @> '[{"name":"property_ownership_type"}]'::jsonb
     OR w.widget_config -> 'fields' @> '[{"name":"property_ownership_company_type"}]'::jsonb
   );

-- Append to the Account "Property" record-type layout (first field group).
-- Other account record types (Vendor, Utility, etc.) aren't touched because
-- ownership type doesn't apply to those.
WITH target AS (
  SELECT w.id AS widget_id
    FROM public.page_layouts pl
    JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND NOT s.is_deleted
    JOIN public.page_layout_widgets  w ON w.section_id = s.id AND NOT w.is_deleted
   WHERE pl.page_layout_object = 'accounts'
     AND pl.page_layout_type   = 'record_detail'
     AND NOT pl.is_deleted
     AND pl.record_type_id = (
       SELECT id FROM public.picklist_values
        WHERE picklist_object='accounts' AND picklist_field='record_type'
          AND picklist_value='Property' LIMIT 1
     )
     AND w.widget_type = 'field_group'
   ORDER BY s.section_order ASC, w.widget_position ASC
   LIMIT 1
)
UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(
     w.widget_config,
     '{fields}',
     coalesce(w.widget_config -> 'fields', '[]'::jsonb) ||
     '[
        {"name":"account_ownership_type",              "type":"picklist", "label":"Ownership Type"},
        {"name":"account_ownership_company_structure", "type":"picklist", "label":"Ownership Company Structure"}
      ]'::jsonb
   )
  FROM target
 WHERE w.id = target.widget_id;

-- Drop property columns + clean field-permission rows.
DELETE FROM public.field_permissions
 WHERE fp_object = 'properties'
   AND fp_field IN ('property_ownership_type', 'property_ownership_company_type');

ALTER TABLE public.properties
  DROP COLUMN IF EXISTS property_ownership_type,
  DROP COLUMN IF EXISTS property_ownership_company_type;

UPDATE public.picklist_values
   SET picklist_is_active = false
 WHERE picklist_object = 'properties'
   AND picklist_field IN ('ownership_type', 'ownership_company_type');
