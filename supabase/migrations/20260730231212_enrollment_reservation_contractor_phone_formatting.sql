-- Display the contact-sourced contractor phone numbers formatted
-- ((515) 297-8363) instead of raw digits, using the renderer's phone format.
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      widget_config, '{fields}',
      (SELECT jsonb_agg(
         CASE WHEN fld->>'type' = 'related_field'
               AND fld->'related'->>'column' = 'contact_phone'
              THEN jsonb_set(fld, '{related,column_type}', '"phone"'::jsonb)
              ELSE fld END)
       FROM jsonb_array_elements(widget_config->'fields') fld)
    ),
    updated_at = now()
WHERE page_layout_id = '94af9c5b-bd66-43e4-b348-f4781efce547'
  AND is_deleted IS NOT TRUE
  AND widget_type = 'field_group'
  AND widget_config ? 'fields'
  AND widget_config->'fields' @> '[{"related":{"column":"contact_phone"}}]';

NOTIFY pgrst, 'reload schema';
