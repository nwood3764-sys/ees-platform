-- The pre-existing service_territories page layout had 7 text columns
-- mis-typed as picklist (record_number, name, street, city, state, zip,
-- country, deletion_reason). Auto-generated labels also duplicated the
-- "Service Territory " prefix awkwardly. Fixing both as part of
-- activating the Admin pane that surfaces these records.

update page_layout_widgets plw
set widget_config = jsonb_set(
  widget_config,
  '{fields}',
  jsonb_build_array(
    jsonb_build_object('name','service_territory_record_number',                  'type','text',     'label','Record Number'),
    jsonb_build_object('name','service_territory_name',                           'type','text',     'label','Name',          'required',true),
    jsonb_build_object('name','parent_territory_id',                              'type','lookup',   'label','Parent Territory',    'lookup_field','service_territory_name', 'lookup_table','service_territories'),
    jsonb_build_object('name','top_level_territory_id',                           'type','lookup',   'label','Top-Level Territory', 'lookup_field','service_territory_name', 'lookup_table','service_territories'),
    jsonb_build_object('name','service_territory_description',                    'type','textarea', 'label','Description'),
    jsonb_build_object('name','service_territory_is_active',                      'type','boolean',  'label','Is Active'),
    jsonb_build_object('name','service_territory_street',                         'type','text',     'label','Street'),
    jsonb_build_object('name','service_territory_city',                           'type','text',     'label','City'),
    jsonb_build_object('name','service_territory_state',                          'type','text',     'label','State'),
    jsonb_build_object('name','service_territory_zip',                            'type','text',     'label','Zip'),
    jsonb_build_object('name','service_territory_country',                        'type','text',     'label','Country'),
    jsonb_build_object('name','service_territory_travel_time_buffer_minutes',     'type','number',   'label','Travel Time Buffer (min)'),
    jsonb_build_object('name','service_territory_avg_travel_time_minutes',        'type','number',   'label','Avg Travel Time (min)'),
    jsonb_build_object('name','service_territory_typical_travel_time_minutes',    'type','number',   'label','Typical Travel Time (min)')
  ),
  false
), updated_at = now()
from page_layouts pl
where plw.page_layout_id = pl.id
  and pl.page_layout_object = 'service_territories'
  and not pl.is_deleted
  and plw.widget_title = 'Details';

update page_layout_widgets plw
set widget_config = jsonb_set(
  widget_config,
  '{fields}',
  jsonb_build_array(
    jsonb_build_object('name','service_territory_owner',           'type','lookup',   'label','Owner',           'lookup_field','user_name', 'lookup_table','users'),
    jsonb_build_object('name','service_territory_created_at',      'type','datetime', 'label','Created At'),
    jsonb_build_object('name','service_territory_updated_at',      'type','datetime', 'label','Updated At'),
    jsonb_build_object('name','service_territory_deleted_at',      'type','datetime', 'label','Deleted At'),
    jsonb_build_object('name','service_territory_deletion_reason', 'type','text',     'label','Deletion Reason')
  ),
  false
), updated_at = now()
from page_layouts pl
where plw.page_layout_id = pl.id
  and pl.page_layout_object = 'service_territories'
  and not pl.is_deleted
  and plw.widget_title = 'System Information';
