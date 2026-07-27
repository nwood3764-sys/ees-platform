-- Reconcile two concurrent changes to validate_page_layout_widget_config().
--
-- Same-day, two branches redefined this trigger:
--   * 20260727002412 (this feature) added a `child_lookup` related-field
--     branch so property "Systems Information" can source from the building on
--     the opportunity.
--   * 20260727005116 (PR #239) rewrote FK resolution from information_schema
--     to pg_catalog — information_schema's constraint views are
--     privilege-filtered, so the SECURITY INVOKER trigger (running as the
--     authenticated end user on save) saw NULL and wrongly rejected valid
--     related fields, which combined with a non-atomic save to WIPE layouts.
--
-- #005116 has a later timestamp, so on prod (and on replay) it overwrote the
-- child_lookup branch — prod's live validator is the pg_catalog version WITHOUT
-- child_lookup, which would reject the property Systems Information widgets on
-- the next layout edit. This migration is the single authoritative definition:
-- master's pg_catalog resolution for plain/dotted fields AND the child_lookup
-- branch (also pg_catalog-based). Ordered after every 2026-07-27 migration so
-- it is the last word in both prod and branch replays.

CREATE OR REPLACE FUNCTION public.validate_page_layout_widget_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  if tg_op = 'UPDATE' and new.is_deleted = true and old.is_deleted = false then
    return new;
  end if;

  select pl.page_layout_object into v_parent_table
  from public.page_layouts pl
  where pl.id = new.page_layout_id;

  if v_parent_table is null then
    return new;
  end if;

  -- ─── field_group ────────────────────────────────────────────────────
  -- Plain names must exist on the parent table. Dotted names
  -- ('<fk_column>.<related_column>') are cross-object read-only fields: the FK
  -- column must exist on the parent AND be a foreign key, and the related
  -- column must exist on the table it references. All metadata is read from
  -- pg_catalog (readable by every role) rather than the privilege-filtered
  -- information_schema views.
  -- EXCEPTION: related_field entries with related.source='child_lookup' resolve
  -- via a child record's lookup and are validated on their own config, not the
  -- dotted-name prefix.
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

      if v_ftype = 'related_field' and v_rel is not null
         and (v_rel->>'source') = 'child_lookup' then
        v_cl_child := v_rel->>'child_table';
        v_cl_fk    := v_rel->>'child_fk';
        v_cl_hop   := v_rel->>'hop_column';
        v_cl_table := v_rel->>'table';
        v_cl_col   := v_rel->>'column';

        if v_cl_child is null or not exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname='public' and c.relname=v_cl_child and c.relkind in ('r','v','m','p','f')
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — child_table "%" does not exist',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_child,'(null)') using errcode='22023';
        end if;

        if v_cl_fk is null or not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_cl_child and a.attname=v_cl_fk and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — child_fk "%" does not exist on "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_fk,'(null)'), v_cl_child using errcode='22023';
        end if;

        if v_cl_hop is null or not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_cl_child and a.attname=v_cl_hop and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — hop_column "%" does not exist on "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_hop,'(null)'), v_cl_child using errcode='22023';
        end if;

        if v_cl_table is null or not exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname='public' and c.relname=v_cl_table and c.relkind in ('r','v','m','p','f')
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — table "%" does not exist',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_table,'(null)') using errcode='22023';
        end if;

        if v_cl_col is null or not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_cl_table and a.attname=v_cl_col and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_col,'(null)'), v_cl_table using errcode='22023';
        end if;

        continue;
      end if;

      if position('.' in v_field_name) > 0 then
        v_rel_fk  := split_part(v_field_name, '.', 1);
        v_rel_col := split_part(v_field_name, '.', 2);

        select cr.relname into v_ref_table
        from pg_constraint con
        join pg_class rel      on rel.oid = con.conrelid
        join pg_namespace ns   on ns.oid  = rel.relnamespace
        join pg_class cr       on cr.oid  = con.confrelid
        join pg_attribute att  on att.attrelid = con.conrelid
                              and att.attnum   = con.conkey[1]
        where con.contype = 'f'
          and ns.nspname  = 'public'
          and rel.relname = v_parent_table
          and array_length(con.conkey, 1) = 1
          and att.attname = v_rel_fk
        limit 1;

        if v_ref_table is null then
          raise exception 'page layout widget %.%: related field "%" — column "%" is not a foreign key on table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, v_rel_fk, v_parent_table using errcode='22023';
        end if;

        if not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_ref_table and a.attname=v_rel_col and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: related field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, v_rel_col, v_ref_table using errcode='22023';
        end if;
      elsif not exists (
        select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=v_parent_table and a.attname=v_field_name and a.attnum>0 and not a.attisdropped
      ) then
        raise exception 'page layout widget %.%: field_group references column "%" which does not exist on table "%"',
          new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, v_parent_table using errcode='22023';
      end if;
    end loop;
  end if;

  -- ─── related_list (pg_catalog, unchanged from #005116) ───────────────
  if new.widget_type = 'related_list' then
    v_child_table := new.widget_config->>'table';
    v_fk_column   := new.widget_config->>'fk';

    if v_child_table is null or v_child_table = '' then
      raise exception 'page layout widget %.%: related_list missing widget_config.table',
        new.page_layout_id, coalesce(new.widget_title,'(untitled)') using errcode='22023';
    end if;

    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname=v_child_table and c.relkind in ('r','v','m','p','f')
    ) then
      raise exception 'page layout widget %.%: related_list references child table "%" which does not exist',
        new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_child_table using errcode='22023';
    end if;

    if v_fk_column is null or v_fk_column = '' then
      raise exception 'page layout widget %.%: related_list missing widget_config.fk',
        new.page_layout_id, coalesce(new.widget_title,'(untitled)') using errcode='22023';
    end if;

    if not exists (
      select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_child_table and a.attname=v_fk_column and a.attnum>0 and not a.attisdropped
    ) then
      raise exception 'page layout widget %.%: related_list FK column "%" does not exist on child table "%"',
        new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_fk_column, v_child_table using errcode='22023';
    end if;

    if new.widget_config ? 'columns' then
      for v_col_name in
        select jsonb_extract_path_text(c, 'name')
        from jsonb_array_elements(new.widget_config->'columns') c
        where jsonb_extract_path_text(c, 'name') is not null
          and jsonb_extract_path_text(c, 'name') <> ''
      loop
        if not exists (
          select 1 from pg_attribute a join pg_class c2 on c2.oid=a.attrelid join pg_namespace n on n.oid=c2.relnamespace
          where n.nspname='public' and c2.relname=v_child_table and a.attname=v_col_name and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: related_list column "%" does not exist on child table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_col_name, v_child_table using errcode='22023';
        end if;
      end loop;
    end if;
  end if;

  return new;
end$function$;

NOTIFY pgrst, 'reload schema';

-- Re-assert both property "Systems Information" field groups (idempotent) so
-- the final state is guaranteed correct regardless of the intermediate
-- validator churn. Target widgets resolved dynamically (layout object + name +
-- section label) — the layout editor recreates widgets with fresh ids.
with base as (
  select jsonb_build_object(
    'source','child_lookup','child_table','opportunities','child_fk','property_id',
    'child_deleted_col','opportunity_is_deleted','child_order_by','opportunity_created_at',
    'child_order_dir','desc','hop_column','building_id','table','buildings'
  ) as rel
),
f(layout_name, pos, label, col, bcol, ctype) as (
  values
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
  from f group by f.layout_name
),
tgt as (
  select agg.layout_name, agg.cfg, (
    select w.id
    from public.page_layouts pl
    join public.page_layout_sections s on s.page_layout_id = pl.id and s.is_deleted is not true
    join public.page_layout_widgets w  on w.section_id = s.id and w.is_deleted is not true and w.widget_type = 'field_group'
    where pl.page_layout_object = 'properties' and pl.is_deleted is not true
      and pl.page_layout_name = agg.layout_name and s.section_label = 'Systems Information'
    order by w.updated_at desc limit 1
  ) as widget_id
  from agg
)
update public.page_layout_widgets w
set widget_config = tgt.cfg, updated_at = now()
from tgt
where w.id = tgt.widget_id and w.is_deleted is not true;
