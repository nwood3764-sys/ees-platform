-- Property "Systems Information" now sourced from the building on the
-- property's opportunity (read-only), instead of the property's own (always
-- null) columns.
--
-- A property holds no outgoing FK to a building; the opportunity does
-- (opportunities.property_id -> this property, opportunities.building_id ->
-- the building). loadRecordDetailData resolves this via the new
-- related.source='child_lookup' path: walk the property's most recent
-- non-deleted opportunity to its single building_id, then read that
-- building's HVAC columns. Values render read-only (RELATED chip), hidden on
-- the create form. Type/fuel fields are picklists (resolved from the
-- building's picklist UUIDs); BTU capacities and year-of-install stay
-- numbers; fuel providers stay text.
--
-- Note: "Water Heating Fuel Type" is a picklist everywhere in intent, but the
-- building stores it as a free-text column (building_water_heating_fuel_type)
-- with no picklist FK column, so it is sourced as text here. Converting the
-- building column to a picklist FK is a separate building-schema change.
--
-- Two field_group widgets are rewritten in place, on the "properties"
-- Multifamily (3-col) and Non-Residential (2-col) layouts. The target widget
-- id is resolved DYNAMICALLY from the layout object + name + section label —
-- the layout editor's save adapter recreates widgets with fresh ids on every
-- edit, so hardcoding ids is unsafe (and unsafe to replay on a branch DB).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Teach the layout-widget validator about child_lookup related fields.
--    The existing validator reads a dotted field name '<fk>.<col>' as a
--    forward FK on the layout object. child_lookup fields also carry a dotted
--    name (for a unique key / save-diff stripping) but resolve via a CHILD
--    record's lookup, so they must be validated against related.{child_table,
--    child_fk, hop_column, table, column} instead of the dotted prefix.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.validate_page_layout_widget_config()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_parent_table text;
  v_field_name   text;
  v_child_table  text;
  v_fk_column    text;
  v_col_name     text;
  v_rel_fk       text;
  v_rel_col      text;
  v_ref_table    text;
  v_field        jsonb;
  v_ftype        text;
  v_rel          jsonb;
  v_cl_child     text;
  v_cl_fk        text;
  v_cl_hop       text;
  v_cl_table     text;
  v_cl_col       text;
begin
  -- Skip validation on soft-delete updates -- we don't want a layout
  -- author to be unable to delete a widget that was already broken.
  if tg_op = 'UPDATE' and new.is_deleted = true and old.is_deleted = false then
    return new;
  end if;

  -- The parent table is on the layout, not the widget. We must look it up.
  select pl.page_layout_object into v_parent_table
  from public.page_layouts pl
  where pl.id = new.page_layout_id;

  if v_parent_table is null then
    -- Layout doesn't exist or was deleted -- defer to FK constraint
    return new;
  end if;

  -- ─── field_group: validate every fields[] entry ─────────────────────
  -- Plain names must exist on the parent table. Dotted names
  -- ('<fk_column>.<related_column>') are cross-object read-only fields:
  -- the FK column must exist on the parent AND be a foreign key, and the
  -- related column must exist on the table that FK references.
  -- EXCEPTION: related_field entries with related.source='child_lookup'
  -- resolve via a child record's lookup and are validated on their own
  -- config, not the dotted prefix.
  if new.widget_type = 'field_group' and new.widget_config ? 'fields' then
    for v_field in
      select f from jsonb_array_elements(new.widget_config->'fields') f
    loop
      v_field_name := jsonb_extract_path_text(v_field, 'name');
      if v_field_name is null or v_field_name = '' then
        continue;
      end if;
      v_ftype := jsonb_extract_path_text(v_field, 'type');
      v_rel   := v_field->'related';

      -- child_lookup related field: reverse-then-forward path.
      if v_ftype = 'related_field' and v_rel is not null
         and (v_rel->>'source') = 'child_lookup' then
        v_cl_child := v_rel->>'child_table';
        v_cl_fk    := v_rel->>'child_fk';
        v_cl_hop   := v_rel->>'hop_column';
        v_cl_table := v_rel->>'table';
        v_cl_col   := v_rel->>'column';

        if v_cl_child is null or not exists (
          select 1 from information_schema.tables
          where table_schema='public' and table_name=v_cl_child
        ) then
          raise exception
            'page layout widget %.%: child_lookup field "%" — child_table "%" does not exist',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'),
            v_field_name, coalesce(v_cl_child,'(null)') using errcode='22023';
        end if;

        if v_cl_fk is null or not exists (
          select 1 from information_schema.columns
          where table_schema='public' and table_name=v_cl_child and column_name=v_cl_fk
        ) then
          raise exception
            'page layout widget %.%: child_lookup field "%" — child_fk "%" does not exist on "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'),
            v_field_name, coalesce(v_cl_fk,'(null)'), v_cl_child using errcode='22023';
        end if;

        if v_cl_hop is null or not exists (
          select 1 from information_schema.columns
          where table_schema='public' and table_name=v_cl_child and column_name=v_cl_hop
        ) then
          raise exception
            'page layout widget %.%: child_lookup field "%" — hop_column "%" does not exist on "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'),
            v_field_name, coalesce(v_cl_hop,'(null)'), v_cl_child using errcode='22023';
        end if;

        if v_cl_table is null or not exists (
          select 1 from information_schema.tables
          where table_schema='public' and table_name=v_cl_table
        ) then
          raise exception
            'page layout widget %.%: child_lookup field "%" — table "%" does not exist',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'),
            v_field_name, coalesce(v_cl_table,'(null)') using errcode='22023';
        end if;

        if v_cl_col is null or not exists (
          select 1 from information_schema.columns
          where table_schema='public' and table_name=v_cl_table and column_name=v_cl_col
        ) then
          raise exception
            'page layout widget %.%: child_lookup field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'),
            v_field_name, coalesce(v_cl_col,'(null)'), v_cl_table using errcode='22023';
        end if;

        continue;
      end if;

      if position('.' in v_field_name) > 0 then
        v_rel_fk  := split_part(v_field_name, '.', 1);
        v_rel_col := split_part(v_field_name, '.', 2);

        select ccu.table_name into v_ref_table
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        where tc.table_schema = 'public'
          and tc.table_name = v_parent_table
          and tc.constraint_type = 'FOREIGN KEY'
          and kcu.column_name = v_rel_fk
        limit 1;

        if v_ref_table is null then
          raise exception
            'page layout widget %.%: related field "%" — column "%" is not a foreign key on table "%"',
            new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
            v_field_name, v_rel_fk, v_parent_table
          using errcode = '22023';
        end if;

        if not exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name   = v_ref_table
            and column_name  = v_rel_col
        ) then
          raise exception
            'page layout widget %.%: related field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
            v_field_name, v_rel_col, v_ref_table
          using errcode = '22023';
        end if;
      elsif not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name   = v_parent_table
          and column_name  = v_field_name
      ) then
        raise exception
          'page layout widget %.%: field_group references column "%" which does not exist on table "%"',
          new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
          v_field_name, v_parent_table
        using errcode = '22023';
      end if;
    end loop;
  end if;

  -- ─── related_list: validate table, fk, and every columns[].name ──────
  if new.widget_type = 'related_list' then
    v_child_table := new.widget_config->>'table';
    v_fk_column   := new.widget_config->>'fk';

    if v_child_table is null or v_child_table = '' then
      raise exception
        'page layout widget %.%: related_list missing widget_config.table',
        new.page_layout_id, coalesce(new.widget_title, '(untitled)')
      using errcode = '22023';
    end if;

    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = v_child_table
    ) then
      raise exception
        'page layout widget %.%: related_list references child table "%" which does not exist',
        new.page_layout_id, coalesce(new.widget_title, '(untitled)'), v_child_table
      using errcode = '22023';
    end if;

    if v_fk_column is null or v_fk_column = '' then
      raise exception
        'page layout widget %.%: related_list missing widget_config.fk',
        new.page_layout_id, coalesce(new.widget_title, '(untitled)')
      using errcode = '22023';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = v_child_table
        and column_name  = v_fk_column
    ) then
      raise exception
        'page layout widget %.%: related_list FK column "%" does not exist on child table "%"',
        new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
        v_fk_column, v_child_table
      using errcode = '22023';
    end if;

    if new.widget_config ? 'columns' then
      for v_col_name in
        select jsonb_extract_path_text(c, 'name')
        from jsonb_array_elements(new.widget_config->'columns') c
        where jsonb_extract_path_text(c, 'name') is not null
          and jsonb_extract_path_text(c, 'name') <> ''
      loop
        if not exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name   = v_child_table
            and column_name  = v_col_name
        ) then
          raise exception
            'page layout widget %.%: related_list column "%" does not exist on child table "%"',
            new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
            v_col_name, v_child_table
          using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;

  return new;
end$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Rewrite the two property "Systems Information" field groups.
-- ─────────────────────────────────────────────────────────────────────────
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
