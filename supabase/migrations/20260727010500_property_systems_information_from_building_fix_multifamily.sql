-- Corrective follow-up to 20260727002412.
--
-- That migration targeted the two property "Systems Information" field_group
-- widgets by hardcoded id. The layout editor's save adapter soft-deletes and
-- RECREATES widgets with fresh ids on every edit, so the Multifamily widget
-- had already been re-created (its old id was stale/deleted) and the update
-- silently missed it — only the Non-Residential widget got rewritten.
--
-- This migration resolves the target widget id DYNAMICALLY from the layout
-- object + name + section label, so it is immune to id churn and safe to
-- replay on a fresh branch database. It rewrites BOTH widgets (idempotent for
-- the already-correct Non-Residential one).
--
-- See 20260727002412 for the full rationale (property Systems Information is
-- read-only, sourced from the building on the property's most recent
-- opportunity via related.source='child_lookup').

with base as (
  select jsonb_build_object(
    'source',            'child_lookup',
    'child_table',       'opportunities',
    'child_fk',          'property_id',
    'child_deleted_col', 'opportunity_is_deleted',
    'child_order_by',    'opportunity_created_at',
    'child_order_dir',   'desc',
    'hop_column',        'building_id',
    'table',             'buildings'
  ) as rel
),
f(layout_name, pos, label, col, bcol, ctype) as (
  values
  -- Multifamily (3-column: col1 heating, col2 cooling, col3 water heating)
  ('Multifamily',      1, 'Water Heating System Type',                 3, 'building_water_heater_type',                'picklist'),
  ('Multifamily',      2, 'Water Heating Equipment Capacity BTUs',      3, 'building_water_heating_equipment_capacity', 'number'),
  ('Multifamily',      3, 'Water Heating Fuel Type',                    3, 'building_water_heating_fuel_type',          'text'),
  ('Multifamily',      4, 'Heating System Type',                        1, 'building_heating_system_type',             'picklist'),
  ('Multifamily',      5, 'Heating Equipment Capacity BTUs',            1, 'building_heating_equipment_capacity',       'number'),
  ('Multifamily',      6, 'Heating Equipment Average Year of Install',  1, 'building_heating_equipment_year_of_install','number'),
  ('Multifamily',      7, 'Heating Fuel Type',                          1, 'building_heating_fuel_type',               'picklist'),
  ('Multifamily',      8, 'Heating Fuel Provider',                      1, 'building_heating_fuel_provider',            'text'),
  ('Multifamily',      9, 'Cooling System Type',                        2, 'building_cooling_type',                    'picklist'),
  ('Multifamily',     10, 'Cooling Equipment Capacity BTUs',            2, 'building_cooling_equipment_capacity',       'number'),
  ('Multifamily',     11, 'Cooling Equipment Avg Year of Install',      2, 'building_cooling_equipment_year_of_install','number'),
  ('Multifamily',     12, 'Electric Fuel Provider',                     2, 'building_electric_fuel_provider',           'text'),
  -- Non-Residential (2-column: col1 heating + water heating, col2 cooling + electric)
  ('Non-Residential',  1, 'Heating Fuel Provider',                      1, 'building_heating_fuel_provider',            'text'),
  ('Non-Residential',  2, 'Heating System Type',                        1, 'building_heating_system_type',             'picklist'),
  ('Non-Residential',  3, 'Heating Fuel Type',                          1, 'building_heating_fuel_type',               'picklist'),
  ('Non-Residential',  4, 'Heating Equipment Capacity BTUs',            1, 'building_heating_equipment_capacity',       'number'),
  ('Non-Residential',  5, 'Heating Equipment Average Year of Install',  1, 'building_heating_equipment_year_of_install','number'),
  ('Non-Residential',  6, 'Water Heating System Type',                  1, 'building_water_heater_type',                'picklist'),
  ('Non-Residential',  7, 'Water Heating Fuel Type',                    1, 'building_water_heating_fuel_type',          'text'),
  ('Non-Residential',  8, 'Water Heating Equipment Capacity BTUs',      1, 'building_water_heating_equipment_capacity', 'number'),
  ('Non-Residential',  9, 'Water Heating Fuel Provider',                1, 'building_water_heating_fuel_provider',      'text'),
  ('Non-Residential', 10, 'Electric Fuel Provider',                     2, 'building_electric_fuel_provider',           'text'),
  ('Non-Residential', 11, 'Cooling System Type',                        2, 'building_cooling_type',                    'picklist'),
  ('Non-Residential', 12, 'Cooling Equipment Capacity BTUs',            2, 'building_cooling_equipment_capacity',       'number'),
  ('Non-Residential', 13, 'Cooling Equipment Avg Year of Install',      2, 'building_cooling_equipment_year_of_install','number')
),
agg as (
  select f.layout_name,
    jsonb_build_object('fields', jsonb_agg(
      jsonb_build_object(
        'name',    'opportunity_building.' || f.bcol,
        'type',    'related_field',
        'label',   f.label,
        'column',  f.col,
        'related', (select rel from base) || jsonb_build_object('column', f.bcol, 'column_type', f.ctype)
      ) order by f.pos
    )) as cfg
  from f
  group by f.layout_name
),
tgt as (
  select agg.layout_name, agg.cfg, (
    select w.id
    from public.page_layouts pl
    join public.page_layout_sections s
      on s.page_layout_id = pl.id and s.is_deleted is not true
    join public.page_layout_widgets w
      on w.section_id = s.id and w.is_deleted is not true and w.widget_type = 'field_group'
    where pl.page_layout_object = 'properties'
      and pl.is_deleted is not true
      and pl.page_layout_name = agg.layout_name
      and s.section_label = 'Systems Information'
    order by w.updated_at desc
    limit 1
  ) as widget_id
  from agg
)
update public.page_layout_widgets w
set widget_config = tgt.cfg,
    updated_at = now()
from tgt
where w.id = tgt.widget_id
  and w.is_deleted is not true;
