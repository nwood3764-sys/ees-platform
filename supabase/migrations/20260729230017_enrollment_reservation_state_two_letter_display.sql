-- IRA HOMES reservation form mirrors a JotForm that shows the state as a
-- two-letter USPS abbreviation. The Primary/Support Contractor and Installation
-- state fields pull from account/property records that store the full name
-- ("Wisconsin"). Tag those related fields with format=us_state_abbrev so the
-- renderer displays "WI". Editable, typed payment-state text is left as-is.
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      widget_config, '{fields}',
      (SELECT jsonb_agg(
         CASE WHEN fld->>'type' = 'related_field'
               AND fld->'related'->>'column' IN ('billing_state','property_state')
              THEN fld || '{"format":"us_state_abbrev"}'::jsonb
              ELSE fld END)
       FROM jsonb_array_elements(widget_config->'fields') fld)
    ),
    updated_at = now()
WHERE page_layout_id = '94af9c5b-bd66-43e4-b348-f4781efce547'
  AND is_deleted IS NOT TRUE
  AND widget_type = 'field_group'
  AND widget_config ? 'fields';

NOTIFY pgrst, 'reload schema';
