-- The pre-existing saved_list_views page layout had several text columns
-- mis-typed as picklist (which causes FieldGroupWidget to fetch empty
-- picklist options instead of rendering an editable text input) and
-- was missing the two jsonb config columns entirely. Fixing both as
-- part of activating the Admin pane that surfaces these records.
--
-- Affected widgets:
--   Details            → rewrite the fields array with correct types,
--                         add list_view_visible_columns + list_view_filters
--                         as json fields (JsonField widget handles the
--                         textarea + parse-validation surface)
--   System Information → deletion_reason text-corrected (was picklist)

update page_layout_widgets plw
set widget_config = jsonb_set(
  widget_config,
  '{fields}',
  jsonb_build_array(
    jsonb_build_object('name','list_view_record_number',   'type','text',    'label','Record Number'),
    jsonb_build_object('name','list_view_name',            'type','text',    'label','Name',          'required',true),
    jsonb_build_object('name','list_view_object',          'type','text',    'label','Object',        'required',true),
    jsonb_build_object('name','list_view_module',          'type','text',    'label','Module'),
    jsonb_build_object('name','list_view_user_id',         'type','lookup',  'label','User',          'lookup_field','user_name', 'lookup_table','users'),
    jsonb_build_object('name','list_view_role_id',         'type','lookup',  'label','Role',          'lookup_field','role_name', 'lookup_table','roles'),
    jsonb_build_object('name','list_view_sort_field',      'type','text',    'label','Sort Field'),
    jsonb_build_object('name','list_view_sort_direction',  'type','text',    'label','Sort Direction'),
    jsonb_build_object('name','list_view_is_default',      'type','boolean', 'label','Is Default'),
    jsonb_build_object('name','list_view_is_shared',       'type','boolean', 'label','Is Shared'),
    jsonb_build_object('name','list_view_visible_columns', 'type','json',    'label','Visible Columns'),
    jsonb_build_object('name','list_view_filters',         'type','json',    'label','Filters')
  ),
  false
), updated_at = now()
from page_layouts pl
where plw.page_layout_id = pl.id
  and pl.page_layout_object = 'saved_list_views'
  and not pl.is_deleted
  and plw.widget_title = 'Details';

update page_layout_widgets plw
set widget_config = jsonb_set(
  widget_config,
  '{fields}',
  jsonb_build_array(
    jsonb_build_object('name','list_view_owner',     'type','lookup',   'label','Owner',           'lookup_field','user_name', 'lookup_table','users'),
    jsonb_build_object('name','created_at',          'type','datetime', 'label','Created At'),
    jsonb_build_object('name','updated_at',          'type','datetime', 'label','Updated At'),
    jsonb_build_object('name','deletion_reason',     'type','text',     'label','Deletion Reason')
  ),
  false
), updated_at = now()
from page_layouts pl
where plw.page_layout_id = pl.id
  and pl.page_layout_object = 'saved_list_views'
  and not pl.is_deleted
  and plw.widget_title = 'System Information';
