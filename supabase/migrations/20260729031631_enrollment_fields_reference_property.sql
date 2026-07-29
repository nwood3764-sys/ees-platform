-- Enrollment layouts: stop SHOWING copied property data — reference the Property
-- (the related record up the family tree) instead. Each copied enrollment_* field
-- on a field_group widget is rewritten to the same `related_field` shape the
-- enrollment layouts already use for the contractor account
-- (enrollment_contractor_account_id.<col>): a read-only, live reflection of the
-- property's column via property_id. Order and labels are preserved.
--
-- The physical enrollment_* columns are intentionally LEFT IN PLACE (reports and
-- the pre-approval document generator still read them). Retiring the copies —
-- stop copying at create, re-point those consumers, drop the columns — is the
-- next, separately-verified step.
WITH mapping(enr, prop, ct) AS (VALUES
  ('enrollment_hud_property_id',        'property_hud_property_id',            'text'),
  ('enrollment_property_name',          'property_name',                      'text'),
  ('enrollment_site_address',           'property_street',                    'text'),
  ('enrollment_city',                   'property_city',                      'text'),
  ('enrollment_state',                  'property_state',                     'text'),
  ('enrollment_zip',                    'property_zip',                       'text'),
  ('enrollment_county',                 'property_county',                    'text'),
  ('enrollment_assisted_units',         'property_assisted_units',            'number'),
  ('enrollment_total_units',            'property_total_units',               'number'),
  ('enrollment_number_of_buildings',    'property_number_of_buildings',       'number'),
  ('enrollment_property_category',      'property_category',                  'text'),
  ('enrollment_owner_organization',     'property_hud_owner_org',             'text'),
  ('enrollment_owner_phone',            'property_hud_owner_phone',           'phone'),
  ('enrollment_owner_email',            'property_hud_owner_email',           'email'),
  ('enrollment_owner_fein',             'fein',                              'text'),
  ('enrollment_management_agent',       'property_hud_management_org',        'text'),
  ('enrollment_management_phone',       'property_hud_management_phone',      'phone'),
  ('enrollment_management_email',       'property_hud_management_email',      'email'),
  ('enrollment_hud_contract_number',    'property_primary_contract_number',   'text'),
  ('enrollment_hud_tracs_status',       'property_primary_contract_tracs_status','text'),
  ('enrollment_hud_contract_expiration','property_primary_contract_expiration','date'),
  ('enrollment_is_202_811',             'property_is_202_811',               'boolean'),
  ('enrollment_is_opportunity_zone',    'property_is_opportunity_zone',       'boolean')
),
tgt AS (
  SELECT w.id, w.widget_config
  FROM public.page_layout_widgets w
  JOIN public.page_layouts pl ON pl.id = w.page_layout_id
  WHERE pl.page_layout_object = 'enrollments' AND pl.is_deleted IS NOT TRUE
    AND w.is_deleted IS NOT TRUE AND w.widget_type = 'field_group'
    AND w.widget_config ? 'fields'
),
rebuilt AS (
  SELECT t.id,
    jsonb_set(t.widget_config, '{fields}', (
      SELECT jsonb_agg(
        CASE
          WHEN m.prop IS NOT NULL AND COALESCE(e.elem->>'type','') <> 'related_field'
          THEN jsonb_build_object(
            'name',  'property_id.' || m.prop,
            'type',  'related_field',
            'label', COALESCE(NULLIF(e.elem->>'label',''), initcap(replace(m.enr, '_', ' '))),
            'related', jsonb_build_object(
              'fk_column', 'property_id', 'table', 'properties',
              'column', m.prop, 'column_type', m.ct)
          )
          ELSE e.elem
        END
        ORDER BY e.ord
      )
      FROM jsonb_array_elements(t.widget_config->'fields') WITH ORDINALITY AS e(elem, ord)
      LEFT JOIN mapping m ON m.enr = e.elem->>'name'
    )) AS new_config
  FROM tgt t
)
UPDATE public.page_layout_widgets w
SET widget_config = r.new_config, updated_at = now()
FROM rebuilt r
WHERE r.id = w.id AND r.new_config IS DISTINCT FROM w.widget_config;
