-- Opportunity page layouts: building field should be a hyperlinked lookup labeled "Building Name".
--
-- Problem (WI-IRA-HOMES layout, record type WI-IRA-MF-HOMES): the building name was placed as a
-- cross-object related_field (building_id.building_name). Related fields are display-only and their
-- label was auto-derived to the bare column leaf "Name" (the object-prefix stripper swallowed
-- "building"). Result: a field captioned "Name" with no link back to the building record.
--
-- Fix:
--   A. WI-IRA-HOMES: replace the display-only related_field with a real building_id lookup
--      (buildings.building_name), so it renders as a hyperlink to the building record, labeled
--      "Building Name". Mirrors the buildings_for_property dependency + inline-create already used
--      on every other opportunity layout.
--   B. All opportunity layouts: relabel the existing building_id lookup "Building" -> "Building Name"
--      so the caption is consistent everywhere.

-- A. Convert the related_field to a building_id lookup on the WI-IRA-HOMES field group.
UPDATE page_layout_widgets
SET widget_config = jsonb_set(
      widget_config,
      '{fields}',
      (SELECT jsonb_agg(
         CASE WHEN elem->>'name' = 'building_id.building_name' AND elem->>'type' = 'related_field'
              THEN jsonb_build_object(
                     'name', 'building_id',
                     'type', 'lookup',
                     'label', 'Building Name',
                     'column', COALESCE((elem->>'column')::int, 1),
                     'lookup_field', 'building_name',
                     'lookup_table', 'buildings',
                     'lookup_dependency', jsonb_build_object(
                         'kind', 'buildings_for_property',
                         'depends_on', jsonb_build_array('property_id'),
                         'create_seed', jsonb_build_object('property_id', 'property_id')),
                     'allow_inline_create', true,
                     'create_object_label', 'Building')
              ELSE elem END)
       FROM jsonb_array_elements(widget_config->'fields') elem)
    ),
    updated_at = now()
WHERE id = '4728d5e4-923a-41e4-a35f-c77eb94f356d'
  AND is_deleted IS NOT TRUE
  AND widget_config->'fields' @> '[{"name":"building_id.building_name","type":"related_field"}]'::jsonb;

-- B. Relabel every opportunity building_id lookup to "Building Name" (covers the layout fixed above too).
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{fields}',
      (SELECT jsonb_agg(
         CASE WHEN elem->>'name' = 'building_id' AND elem->>'type' = 'lookup'
              THEN elem || '{"label":"Building Name"}'::jsonb
              ELSE elem END)
       FROM jsonb_array_elements(w.widget_config->'fields') elem)
    ),
    updated_at = now()
FROM page_layouts pl
WHERE w.page_layout_id = pl.id
  AND pl.page_layout_object = 'opportunities'
  AND pl.is_deleted IS NOT TRUE
  AND w.is_deleted IS NOT TRUE
  AND w.widget_type = 'field_group'
  AND w.widget_config->'fields' @> '[{"name":"building_id","type":"lookup"}]'::jsonb;
