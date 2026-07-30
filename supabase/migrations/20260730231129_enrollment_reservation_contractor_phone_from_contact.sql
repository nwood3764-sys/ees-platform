-- Contractor phone should follow the selected contact, not the account.
-- Accounts frequently carry no phone (the EES-WI account is null), while the
-- contact record does — so "select Nicholas Wood" should fill his phone. The
-- Primary and Support Contractor "Phone Number" fields are repointed from
-- <account>.account_phone to the section's selected contact's contact_phone.
-- Business name + address stay account-sourced.
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(
      widget_config, '{fields}',
      (SELECT jsonb_agg(
         CASE
           WHEN fld->>'type' = 'related_field'
                AND fld->'related'->>'column' = 'account_phone'
                AND fld->'related'->>'fk_column' = 'enrollment_contractor_account_id'
           THEN jsonb_build_object(
                  'name','enrollment_contractor_contact_id.contact_phone',
                  'type','related_field',
                  'label', fld->>'label',
                  'column', fld->'column',
                  'related', jsonb_build_object(
                    'table','contacts','column','contact_phone',
                    'fk_column','enrollment_contractor_contact_id','column_type','text'))
           WHEN fld->>'type' = 'related_field'
                AND fld->'related'->>'column' = 'account_phone'
                AND fld->'related'->>'fk_column' = 'enrollment_support_contractor_account_id'
           THEN jsonb_build_object(
                  'name','enrollment_support_contractor_contact_id.contact_phone',
                  'type','related_field',
                  'label', fld->>'label',
                  'column', fld->'column',
                  'related', jsonb_build_object(
                    'table','contacts','column','contact_phone',
                    'fk_column','enrollment_support_contractor_contact_id','column_type','text'))
           ELSE fld
         END)
       FROM jsonb_array_elements(widget_config->'fields') fld)
    ),
    updated_at = now()
WHERE page_layout_id = '94af9c5b-bd66-43e4-b348-f4781efce547'
  AND is_deleted IS NOT TRUE
  AND widget_type = 'field_group'
  AND widget_config ? 'fields'
  AND widget_config->'fields' @> '[{"related":{"column":"account_phone"}}]';

NOTIFY pgrst, 'reload schema';
