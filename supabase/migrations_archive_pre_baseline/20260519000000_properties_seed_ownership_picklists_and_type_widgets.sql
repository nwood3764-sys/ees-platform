-- Seed ownership_type and ownership_company_type picklists for properties,
-- and retype both widgets to 'picklist' on every Property page layout.

INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order, picklist_is_active)
VALUES
  ('properties', 'ownership_type', 'For-Profit',        'For-Profit',        1, true),
  ('properties', 'ownership_type', 'Non-Profit',        'Non-Profit',        2, true),
  ('properties', 'ownership_type', 'Public Housing',    'Public Housing',    3, true),
  ('properties', 'ownership_type', 'Tribal',            'Tribal',            4, true),
  ('properties', 'ownership_type', 'Government',        'Government',        5, true),
  ('properties', 'ownership_type', 'Other',             'Other',             6, true),

  ('properties', 'ownership_company_type', 'LLC',                  'LLC',                  1, true),
  ('properties', 'ownership_company_type', 'Limited Partnership',  'Limited Partnership',  2, true),
  ('properties', 'ownership_company_type', 'Corporation',          'Corporation',          3, true),
  ('properties', 'ownership_company_type', 'S-Corp',               'S-Corp',               4, true),
  ('properties', 'ownership_company_type', 'Non-Profit Corp',      'Non-Profit Corp',      5, true),
  ('properties', 'ownership_company_type', 'Trust',                'Trust',                6, true),
  ('properties', 'ownership_company_type', 'Sole Proprietor',      'Sole Proprietor',      7, true),
  ('properties', 'ownership_company_type', 'Government Agency',    'Government Agency',    8, true),
  ('properties', 'ownership_company_type', 'Tribal Entity',        'Tribal Entity',        9, true),
  ('properties', 'ownership_company_type', 'Other',                'Other',               10, true)
ON CONFLICT (picklist_object, picklist_field, picklist_value) DO NOTHING;

UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(
     w.widget_config,
     '{fields}',
     (
       SELECT jsonb_agg(
         CASE
           WHEN f->>'name' IN ('property_ownership_type','property_ownership_company_type')
                AND f->>'type' IS DISTINCT FROM 'picklist'
           THEN f || jsonb_build_object('type','picklist')
           ELSE f
         END
       )
       FROM jsonb_array_elements(w.widget_config -> 'fields') AS f
     )
   )
  FROM public.page_layouts pl
 WHERE w.page_layout_id = pl.id
   AND pl.page_layout_object = 'properties'
   AND pl.page_layout_type = 'record_detail'
   AND NOT pl.is_deleted
   AND NOT w.is_deleted
   AND w.widget_type = 'field_group'
   AND w.widget_config -> 'fields' @> '[{"name":"property_ownership_type"}]'::jsonb;
