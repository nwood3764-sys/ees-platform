-- Incentive Applications: stop SHOWING copied building/property/opportunity data —
-- reference those parent records instead. Same treatment as the enrollment layouts
-- (migration 20260729031631), but incentive_applications draws from THREE parents
-- (building_id, property_id, opportunity_id), so each converted field carries its
-- own fk_column in the related config. The field keeps its original name (several
-- ia_* fields share one source column, which would collide under a dotted name).
--
-- Only the ~21 fields the create-prefill actually copies are converted. The other
-- ~70 ia_* fields are the application's OWN data (equipment, rebates, dates,
-- questions) and are left alone. The state-computed EES contractor fields and the
-- 2-hop business-entity (account) fields are NOT parent copies in the 1-hop sense
-- and are left for a follow-up.
--
-- Physical ia_* columns are kept (the create-copy still fills them until the code
-- side stops it in the same change); nothing else in the app reads these columns.
WITH mapping(fld, fk, tbl, col, ct) AS (VALUES
  -- Building (building_id → buildings)
  ('ia_building_square_footage',          'building_id',    'buildings',     'building_square_footage',       'number'),
  ('ia_total_building_square_footage',    'building_id',    'buildings',     'building_square_footage',       'number'),
  ('ia_total_floors_in_building',         'building_id',    'buildings',     'building_stories',              'number'),
  ('ia_year_the_building_was_built',      'building_id',    'buildings',     'building_year_built',           'text'),
  ('ia_multifamily_of_units_in_building', 'building_id',    'buildings',     'building_total_units',          'number'),
  ('ia_installation_address_street',      'building_id',    'buildings',     'building_address',              'text'),
  ('ia_installation_address_city',        'building_id',    'buildings',     'building_city',                 'text'),
  ('ia_installation_address_state',       'building_id',    'buildings',     'building_state',                'text'),
  ('ia_installation_address_zip',         'building_id',    'buildings',     'building_zip',                  'text'),
  ('ia_electric_provider',                'building_id',    'buildings',     'building_electric_utility',     'text'),
  ('ia_natural_gas_provider',             'building_id',    'buildings',     'building_gas_utility',          'text'),
  ('ia_other_heating_fuel_provider',      'building_id',    'buildings',     'building_heating_fuel_provider','text'),
  -- Property (property_id → properties)
  ('ia_total_number_of_units',            'property_id',    'properties',    'property_total_units',          'number'),
  ('ia_total_number_of_occupied_units',   'property_id',    'properties',    'property_ph_total_occupied',    'number'),
  ('ia_building_owner_name',              'property_id',    'properties',    'property_hud_owner_org',        'text'),
  ('ia_building_owner_name_ira',          'property_id',    'properties',    'property_hud_owner_org',        'text'),
  ('ia_building_owner_email_address',     'property_id',    'properties',    'property_hud_owner_email',      'email'),
  ('ia_building_owner_office_phone',      'property_id',    'properties',    'property_hud_owner_phone',      'phone'),
  -- Opportunity (opportunity_id → opportunities)
  ('ia_income_qualified_confirmation_code','opportunity_id','opportunities', 'opportunity_income_qualified_confirmation_code', 'text'),
  ('ia_electric_account_number',          'opportunity_id', 'opportunities', 'opportunity_electric_account_number', 'text'),
  ('ia_natural_gas_account_number',       'opportunity_id', 'opportunities', 'opportunity_gas_account_number', 'text')
),
tgt AS (
  SELECT w.id, w.widget_config
  FROM public.page_layout_widgets w
  JOIN public.page_layouts pl ON pl.id = w.page_layout_id
  WHERE pl.page_layout_object = 'incentive_applications' AND pl.is_deleted IS NOT TRUE
    AND w.is_deleted IS NOT TRUE AND w.widget_type = 'field_group'
    AND w.widget_config ? 'fields'
),
rebuilt AS (
  SELECT t.id,
    jsonb_set(t.widget_config, '{fields}', (
      SELECT jsonb_agg(
        CASE
          WHEN m.fld IS NOT NULL AND COALESCE(e.elem->>'type','') <> 'related_field'
          THEN jsonb_build_object(
            'name',  e.elem->>'name',
            'type',  'related_field',
            'label', COALESCE(NULLIF(e.elem->>'label',''), initcap(replace(m.fld, '_', ' '))),
            'related', jsonb_build_object(
              'fk_column', m.fk, 'table', m.tbl, 'column', m.col, 'column_type', m.ct)
          )
          ELSE e.elem
        END
        ORDER BY e.ord
      )
      FROM jsonb_array_elements(t.widget_config->'fields') WITH ORDINALITY AS e(elem, ord)
      LEFT JOIN mapping m ON m.fld = e.elem->>'name'
    )) AS new_config
  FROM tgt t
)
UPDATE public.page_layout_widgets w
SET widget_config = r.new_config, updated_at = now()
FROM rebuilt r
WHERE r.id = w.id AND r.new_config IS DISTINCT FROM w.widget_config;
