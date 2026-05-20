-- HOTFIX. Migration 20260519070000 referenced columns that don't exist:
--   opportunity_contact_roles: assumed role/is_primary/created_at/is_deleted
--     — actually ocr_role, ocr_is_primary, ocr_created_at, ocr_is_deleted
--   opportunity_line_items: assumed product_name/quantity/unit_price/total_price/created_at/is_deleted
--     — actually oli_name, oli_quantity, oli_unit_price, oli_total_price, oli_created_at, oli_is_deleted
--   conversations: assumed conversation_*/conversation_is_deleted
--     — actually conv_subject, conv_channel, conv_status, conv_created_at, conv_is_deleted
--
-- The wrong column names caused the related-list query to fail when any
-- Contact or Opportunity record page tried to load, surfacing as
-- "Error loading record: column opportunity_contact_roles.role does
-- not exist" and similar. This affected every Contact (6 layouts × 1
-- broken list) and every Opportunity (24 layouts × 2 broken lists).

UPDATE public.page_layout_widgets
   SET widget_config = jsonb_build_object(
         'fk',             'contact_id',
         'table',          'opportunity_contact_roles',
         'title',          'Opportunity Contact Roles',
         'columns',        jsonb_build_array(
                              jsonb_build_object('name','ocr_record_number','type','text',   'label','Record #'),
                              jsonb_build_object('name','ocr_name',         'type','text',   'label','Name'),
                              jsonb_build_object('name','ocr_is_primary',   'type','boolean','label','Primary')
                           ),
         'sort_dir',       'desc',
         'sort_field',     'ocr_created_at',
         'is_deleted_col', 'ocr_is_deleted'
       )::jsonb
 WHERE widget_type = 'related_list'
   AND widget_config->>'table' = 'opportunity_contact_roles'
   AND NOT is_deleted;

UPDATE public.page_layout_widgets
   SET widget_config = jsonb_build_object(
         'fk',             'opportunity_id',
         'table',          'opportunity_line_items',
         'title',          'Line Items',
         'columns',        jsonb_build_array(
                              jsonb_build_object('name','oli_record_number','type','text',    'label','Record #'),
                              jsonb_build_object('name','oli_name',         'type','text',    'label','Name'),
                              jsonb_build_object('name','oli_quantity',     'type','number',  'label','Qty'),
                              jsonb_build_object('name','oli_unit_price',   'type','currency','label','Unit Price'),
                              jsonb_build_object('name','oli_total_price',  'type','currency','label','Total')
                           ),
         'sort_dir',       'asc',
         'sort_field',     'oli_created_at',
         'is_deleted_col', 'oli_is_deleted'
       )::jsonb
 WHERE widget_type = 'related_list'
   AND widget_config->>'table' = 'opportunity_line_items'
   AND NOT is_deleted;

UPDATE public.page_layout_widgets
   SET widget_config = jsonb_build_object(
         'fk',             'contact_id',
         'table',          'conversations',
         'title',          'Conversations',
         'columns',        jsonb_build_array(
                              jsonb_build_object('name','conv_record_number','type','text',    'label','Record #'),
                              jsonb_build_object('name','conv_subject',      'type','text',    'label','Subject'),
                              jsonb_build_object('name','conv_channel',      'type','picklist','label','Channel'),
                              jsonb_build_object('name','conv_status',       'type','picklist','label','Status')
                           ),
         'sort_dir',       'desc',
         'sort_field',     'conv_created_at',
         'is_deleted_col', 'conv_is_deleted'
       )::jsonb
 WHERE widget_type = 'related_list'
   AND widget_config->>'table' = 'conversations'
   AND NOT is_deleted;
