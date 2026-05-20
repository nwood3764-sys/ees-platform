-- Add Properties, Contacts, and Opportunities as related lists on every
-- Account page layout. Each Account layout gets a new "Related Records"
-- section appended at the end with these three child lists. All record-
-- type-specific layouts (Property, Single Family, Vendor, Utility, etc.)
-- share the same children — there's no good reason to vary the related
-- lists per record type for the standard CRM children.

WITH layout_targets AS (
  SELECT pl.id AS layout_id
    FROM public.page_layouts pl
   WHERE pl.page_layout_object = 'accounts'
     AND pl.page_layout_type   = 'record_detail'
     AND pl.page_layout_is_default = true
     AND NOT pl.is_deleted
),
new_sections AS (
  INSERT INTO public.page_layout_sections
    (page_layout_id, section_label, section_order, section_is_collapsible, is_deleted)
  SELECT
    lt.layout_id,
    'Related Records',
    coalesce((SELECT max(section_order) + 1 FROM page_layout_sections s
              WHERE s.page_layout_id = lt.layout_id AND NOT s.is_deleted), 1),
    true,
    false
    FROM layout_targets lt
    RETURNING id AS section_id, page_layout_id
)
INSERT INTO public.page_layout_widgets
  (page_layout_id, section_id, widget_type, widget_title, widget_position, widget_config, is_deleted)
SELECT
  ns.page_layout_id,
  ns.section_id,
  'related_list',
  title,
  pos,
  cfg::jsonb,
  false
FROM new_sections ns
CROSS JOIN LATERAL (VALUES
  (1, 'Properties', '{
    "fk":"property_account_id",
    "table":"properties",
    "title":"Properties",
    "columns":[
      {"name":"property_record_number","type":"text","label":"Record #"},
      {"name":"property_name","type":"text","label":"Name"},
      {"name":"property_city","type":"text","label":"City"},
      {"name":"property_state","type":"text","label":"State"},
      {"name":"property_status","type":"picklist","label":"Status"},
      {"name":"property_created_at","type":"datetime","label":"Created"}
    ],
    "sort_dir":"desc",
    "sort_field":"property_created_at",
    "is_deleted_col":"property_is_deleted"
  }'),
  (2, 'Contacts', '{
    "fk":"contact_account_id",
    "table":"contacts",
    "title":"Contacts",
    "columns":[
      {"name":"contact_record_number","type":"text","label":"Record #"},
      {"name":"contact_name","type":"text","label":"Name"},
      {"name":"contact_email","type":"text","label":"Email"},
      {"name":"contact_phone","type":"text","label":"Phone"},
      {"name":"contact_status","type":"picklist","label":"Status"},
      {"name":"contact_created_at","type":"datetime","label":"Created"}
    ],
    "sort_dir":"desc",
    "sort_field":"contact_created_at",
    "is_deleted_col":"contact_is_deleted"
  }'),
  (3, 'Opportunities', '{
    "fk":"opportunity_account_id",
    "table":"opportunities",
    "title":"Opportunities",
    "columns":[
      {"name":"opportunity_record_number","type":"text","label":"Record #"},
      {"name":"opportunity_name","type":"text","label":"Name"},
      {"name":"opportunity_status","type":"picklist","label":"Status"},
      {"name":"opportunity_created_at","type":"datetime","label":"Created"}
    ],
    "sort_dir":"desc",
    "sort_field":"opportunity_created_at",
    "is_deleted_col":"opportunity_is_deleted"
  }')
) AS rl(pos, title, cfg);
