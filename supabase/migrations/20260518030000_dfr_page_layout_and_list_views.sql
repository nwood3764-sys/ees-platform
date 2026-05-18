-- ─── DFR page layout + list views + sequence alignment ────────────────
-- Renders dispatcher_followup_requests as a first-class object in the
-- platform UI: default record-detail layout, two shared list views in
-- the field module, and a one-off sequence-bump for saved_list_view_seq
-- which had drifted from the existing LV-00001..LV-00010 rows (probably
-- from a prior bulk import that bypassed the auto-numbering trigger).

select setval('saved_list_view_seq', 100);
select setval('page_layout_seq', greatest(
  (select max(substring(page_layout_record_number from 4)::int) from page_layouts where page_layout_record_number ~ '^PL-\d+$'),
  100
));
select setval('page_layout_widget_seq', greatest(
  (select max(substring(page_layout_widget_record_number from 5)::int) from page_layout_widgets where page_layout_widget_record_number ~ '^PLW-\d+$'),
  100
));

with new_layout as (
  insert into page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    page_layout_owner, page_layout_created_by
  )
  values (
    '', 'Dispatcher Follow-up Request', 'dispatcher_followup_requests',
    'record_detail', true,
    'Default record-detail layout for dispatcher_followup_requests (DFR-####). Captured leads from the public scheduling pages.',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af'
  )
  returning id
),
new_section as (
  insert into page_layout_sections (
    page_layout_id, section_order, section_label, section_columns,
    section_is_collapsible, section_tab
  )
  select id, 1, 'Details', 2, false, 'Details' from new_layout
  returning id, page_layout_id
)
insert into page_layout_widgets (
  page_layout_widget_record_number, page_layout_id, section_id,
  widget_type, widget_title, widget_column, widget_position,
  widget_config, widget_is_user_customizable, widget_is_required
)
select '', new_section.page_layout_id, new_section.id,
       'field_group', title, col, pos, config::jsonb, false, false
from new_section,
(values
  ('Customer Information', 1, 1, '{
    "fields": [
      { "name": "dfr_customer_first_name", "label": "First Name", "required": true },
      { "name": "dfr_customer_last_name",  "label": "Last Name",  "required": true },
      { "name": "dfr_phone",               "label": "Phone" },
      { "name": "dfr_email",               "label": "Email" }
    ]
  }'),
  ('Address', 1, 2, '{
    "fields": [
      { "name": "dfr_address_street", "label": "Street" },
      { "name": "dfr_address_city",   "label": "City" },
      { "name": "dfr_address_state",  "label": "State" },
      { "name": "dfr_address_zip",    "label": "ZIP" }
    ]
  }'),
  ('Request Details', 2, 1, '{
    "fields": [
      { "name": "work_type_id",          "type": "lookup",   "label": "Work Type", "lookup_field": "work_type_name" },
      { "name": "dfr_work_type_slug",    "label": "Work Type Slug" },
      { "name": "dfr_preferred_start_at","label": "Preferred Start" },
      { "name": "dfr_reason",            "type": "picklist", "label": "Reason" }
    ]
  }'),
  ('Status & Resolution', 2, 2, '{
    "fields": [
      { "name": "dfr_status",              "type": "picklist", "label": "Status" },
      { "name": "dfr_dispatcher_notes",    "label": "Dispatcher Notes" },
      { "name": "dfr_resolution",          "label": "Resolution" },
      { "name": "dfr_resolved_at",         "label": "Resolved At" },
      { "name": "dfr_resolved_by",         "type": "lookup",   "label": "Resolved By", "lookup_field": "user_name" }
    ]
  }')
) as t(title, col, pos, config);

insert into saved_list_views (
  list_view_record_number, list_view_name, list_view_object, list_view_module,
  list_view_filters, list_view_sort_field, list_view_sort_direction,
  list_view_visible_columns, list_view_is_default, list_view_is_shared,
  list_view_owner, list_view_created_by
) values
  (
    '', 'All Dispatcher Follow-ups', 'dispatcher_followup_requests', 'field',
    '[]'::jsonb,
    'dfr_created_at', 'desc',
    '["dfr_record_number","dfr_customer_first_name","dfr_customer_last_name","dfr_address_city","dfr_address_state","dfr_reason","dfr_status","dfr_created_at"]'::jsonb,
    true, true,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
  ),
  (
    '', 'Open Queue', 'dispatcher_followup_requests', 'field',
    '[{"field":"dfr_status","operator":"in","value":["Open","In Progress"]}]'::jsonb,
    'dfr_created_at', 'asc',
    '["dfr_record_number","dfr_customer_first_name","dfr_customer_last_name","dfr_phone","dfr_address_city","dfr_address_state","dfr_reason","dfr_status","dfr_created_at"]'::jsonb,
    false, true,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
  );
