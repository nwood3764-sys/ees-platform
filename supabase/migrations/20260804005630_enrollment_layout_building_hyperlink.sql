-- WI-IRA-MF-HOMES assessment enrollment layout fixes:
--   1. The building was shown as a read-only related_field
--      ("building_id.building_name") that rendered as plain text. Replace it
--      with a real building_id lookup so it hyperlinks to the building record
--      and can be changed (scoped to the enrollment's property).
--   2. "Number of Buildings" must be the enrollment's own building-specific
--      column, not the parent property's total. Repoint any widget still
--      referencing property_id.property_number_of_buildings.

-- 1. Building lookup (hyperlink) in place of the read-only related_field.
UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{fields}',
      (
        SELECT jsonb_agg(
          CASE WHEN elem->>'name' = 'building_id.building_name'
               THEN jsonb_build_object(
                      'name','building_id',
                      'type','lookup',
                      'label','Building',
                      'column', COALESCE(elem->'column','1'::jsonb),
                      'lookup_field','building_name',
                      'lookup_table','buildings',
                      'lookup_dependency', jsonb_build_object(
                        'kind','buildings_for_property',
                        'depends_on', jsonb_build_array('property_id')
                      )
                    )
               ELSE elem END
        )
        FROM jsonb_array_elements(w.widget_config->'fields') elem
      )
    ),
    updated_at = now()
WHERE w.page_layout_id = '68d28e30-2369-42e6-9baf-a2bad552cae3'
  AND w.is_deleted IS NOT TRUE
  AND w.widget_config->'fields' @> '[{"name":"building_id.building_name"}]';

-- 2. Number of Buildings -> the enrollment's building-specific column.
UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{fields}',
      (
        SELECT jsonb_agg(
          CASE WHEN elem->>'name' = 'property_id.property_number_of_buildings'
               THEN jsonb_build_object(
                      'name','enrollment_number_of_buildings',
                      'type','integer',
                      'label','Number of Buildings',
                      'column', COALESCE(elem->'column','1'::jsonb)
                    )
               ELSE elem END
        )
        FROM jsonb_array_elements(w.widget_config->'fields') elem
      )
    ),
    updated_at = now()
WHERE w.page_layout_id = '68d28e30-2369-42e6-9baf-a2bad552cae3'
  AND w.is_deleted IS NOT TRUE
  AND w.widget_config->'fields' @> '[{"name":"property_id.property_number_of_buildings"}]';
