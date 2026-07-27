-- Unit record types + dwelling-unit-only rollups
-- ---------------------------------------------------------------------------
-- Units exist for every real space in a building — including mechanical rooms,
-- attics, hallways, and offices — because field crews issue work orders against
-- those spaces. But the "number of units" a program cares about is the count of
-- lived-in RENTAL dwellings, not the boiler room. Rather than bespoke naming
-- logic, we classify units with a proper record type (Salesforce parity) and
-- count only "Dwelling Unit" toward every unit rollup.
--
-- This migration:
--   1. Seeds six unit record types (Dwelling Unit, Mechanical Room, Attic Space,
--      Hallway, Common Area, Office).
--   2. Gives each record type its own record-detail page layout (cloned from the
--      master "Unit Detail" so it is independently customizable), exactly like
--      every other record-typed object.
--   3. Rewrites the building / property / account unit rollups to count only
--      Dwelling Unit records, and propagates the property's dwelling-unit total
--      onto its opportunities.
--   4. Backfills existing units' record types from their unit number/name, and
--      recomputes every affected rollup.
-- ---------------------------------------------------------------------------

-- 1) Record type picklist values -------------------------------------------
insert into picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_by, picklist_description)
select gen_random_uuid(), 'units', 'record_type', v.val, v.val, true, v.ord,
       (select picklist_created_by from picklist_values
         where picklist_object='units' and picklist_field='record_type'
         order by picklist_created_at nulls last limit 1),
       v.descr
from (values
  ('Dwelling Unit',   1, 'A lived-in rental dwelling. Only these count toward unit totals.'),
  ('Mechanical Room', 2, 'Boiler/mechanical/utility room. Serviceable, not a dwelling.'),
  ('Attic Space',     3, 'Attic space. Serviceable, not a dwelling.'),
  ('Hallway',         4, 'Corridor / stairwell / shared circulation space.'),
  ('Common Area',     5, 'Shared common area (laundry, lobby, storage, etc.).'),
  ('Office',          6, 'Leasing/management office space.')
) as v(val, ord, descr)
where not exists (
  select 1 from picklist_values p
   where p.picklist_object='units' and p.picklist_field='record_type' and p.picklist_value=v.val
);

-- 2) Generic page-layout clone helper --------------------------------------
-- Copies a record_detail layout (row + sections + widgets + action overrides)
-- to a new record type, so the new type has its own independently-editable
-- layout. Widget section_ids are remapped to the cloned sections.
create or replace function clone_page_layout(
  p_source_layout_id uuid,
  p_new_record_type_id uuid,
  p_new_name text
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_new_layout_id uuid := gen_random_uuid();
  v_new_section_id uuid;
  sec record;
begin
  insert into page_layouts
    (id, page_layout_name, page_layout_object, page_layout_type, role_id,
     page_layout_is_default, page_layout_description, page_layout_owner,
     page_layout_created_by, record_type_id, is_deleted)
  select v_new_layout_id, p_new_name, page_layout_object, page_layout_type, role_id,
         true, page_layout_description, page_layout_owner,
         page_layout_created_by, p_new_record_type_id, false
    from page_layouts where id = p_source_layout_id;

  -- Sections + their widgets (remap section_id per section as we go).
  for sec in
    select * from page_layout_sections
     where page_layout_id = p_source_layout_id and is_deleted = false
     order by section_order
  loop
    v_new_section_id := gen_random_uuid();
    insert into page_layout_sections
      (id, page_layout_id, section_order, section_label, section_columns,
       section_is_collapsible, section_is_collapsed_by_default, section_tab,
       is_deleted, section_placement)
    values
      (v_new_section_id, v_new_layout_id, sec.section_order, sec.section_label, sec.section_columns,
       sec.section_is_collapsible, sec.section_is_collapsed_by_default, sec.section_tab,
       false, sec.section_placement);

    insert into page_layout_widgets
      (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
       widget_position, widget_size, widget_config, widget_is_user_customizable,
       widget_is_required, is_deleted)
    select gen_random_uuid(), v_new_layout_id, v_new_section_id, widget_type, widget_title, widget_column,
           widget_position, widget_size, widget_config, widget_is_user_customizable,
           widget_is_required, false
      from page_layout_widgets
     where page_layout_id = p_source_layout_id and section_id = sec.id and is_deleted = false;
  end loop;

  -- Any layout-level widgets not attached to a section.
  insert into page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_size, widget_config, widget_is_user_customizable,
     widget_is_required, is_deleted)
  select gen_random_uuid(), v_new_layout_id, null, widget_type, widget_title, widget_column,
         widget_position, widget_size, widget_config, widget_is_user_customizable,
         widget_is_required, false
    from page_layout_widgets
   where page_layout_id = p_source_layout_id and section_id is null and is_deleted = false;

  -- Action tier overrides.
  insert into page_layout_actions
    (id, pla_page_layout_id, pla_action_key, pla_label_override, pla_display_tier,
     pla_sort_order, pla_visibility_role_id, pla_owner, pla_created_by, pla_is_deleted)
  select gen_random_uuid(), v_new_layout_id, pla_action_key, pla_label_override, pla_display_tier,
         pla_sort_order, pla_visibility_role_id, pla_owner, pla_created_by, false
    from page_layout_actions
   where pla_page_layout_id = p_source_layout_id and pla_is_deleted = false;

  return v_new_layout_id;
end;
$function$;

revoke all on function clone_page_layout(uuid, uuid, text) from public, anon, authenticated;

-- Clone the master "Unit Detail" layout into one layout per new record type.
do $$
declare
  v_master uuid;
  rt record;
begin
  select id into v_master
    from page_layouts
   where page_layout_object='units' and page_layout_type='record_detail'
     and record_type_id is null and page_layout_is_default = true and is_deleted = false
   order by created_at limit 1;
  if v_master is null then
    raise exception 'No master units layout found to clone';
  end if;

  for rt in
    select id, picklist_value from picklist_values
     where picklist_object='units' and picklist_field='record_type' and picklist_is_active = true
       and picklist_value in ('Dwelling Unit','Mechanical Room','Attic Space','Hallway','Common Area','Office')
  loop
    -- Skip if this record type already has its own default layout.
    if not exists (
      select 1 from page_layouts
       where page_layout_object='units' and page_layout_type='record_detail'
         and record_type_id = rt.id and page_layout_is_default = true and is_deleted = false
    ) then
      perform clone_page_layout(v_master, rt.id, rt.picklist_value || ' Layout');
    end if;
  end loop;
end;
$$;

-- 3) Rollups: count only Dwelling Unit records -----------------------------
create or replace function public.recompute_building_rollups(p_building_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_property_id uuid;
  v_dwelling uuid;
begin
  if p_building_id is null then return; end if;

  select id into v_dwelling from picklist_values
   where picklist_object='units' and picklist_field='record_type'
     and picklist_value='Dwelling Unit' limit 1;

  update buildings b set
    building_number_of_units               = agg.units_ct::numeric,
    building_total_units                   = agg.units_ct,
    building_number_of_studio              = agg.studio_ct,
    building_number_of_one_bedrooms        = agg.one_ct,
    building_number_of_two_bedrooms        = agg.two_ct,
    building_number_of_three_bedroom_units = agg.three_ct,
    building_number_of_four_bedrooms       = agg.four_plus_ct,
    building_number_of_bedrooms            = agg.bedrooms_sum,
    building_average_sq_ft_of_units        = agg.avg_sqft,
    building_full_bathrooms                = agg.full_bath_sum,
    building_half_bathrooms                = agg.half_bath_sum
  from (
    select
      count(*)::int                                     as units_ct,
      count(*) filter (where u.unit_bedrooms = 0)::int  as studio_ct,
      count(*) filter (where u.unit_bedrooms = 1)::int  as one_ct,
      count(*) filter (where u.unit_bedrooms = 2)::int  as two_ct,
      count(*) filter (where u.unit_bedrooms = 3)::int  as three_ct,
      count(*) filter (where u.unit_bedrooms >= 4)::int as four_plus_ct,
      sum(u.unit_bedrooms)::int                         as bedrooms_sum,
      round(avg(u.unit_square_footage))::numeric        as avg_sqft,
      sum(u.unit_full_bathrooms)::int                   as full_bath_sum,
      sum(u.unit_half_bathrooms)::int                   as half_bath_sum
    from units u
    where u.building_id = p_building_id and not u.unit_is_deleted
      and u.unit_record_type = v_dwelling
  ) agg
  where b.id = p_building_id
  returning b.property_id into v_property_id;

  perform recompute_property_rollups(v_property_id);
end;
$function$;

create or replace function public.recompute_property_rollups(p_property_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_buildings  int;
  v_units      int;
  v_dwelling   uuid;
begin
  if p_property_id is null then return; end if;

  select id into v_dwelling from picklist_values
   where picklist_object='units' and picklist_field='record_type'
     and picklist_value='Dwelling Unit' limit 1;

  select count(*)::int into v_buildings from buildings b
   where b.property_id = p_property_id and not b.building_is_deleted;

  select count(*)::int into v_units from units u
    join buildings b on b.id = u.building_id and not b.building_is_deleted
   where b.property_id = p_property_id and not u.unit_is_deleted
     and u.unit_record_type = v_dwelling;

  update properties p
     set property_number_of_buildings   = v_buildings::numeric,
         property_total_buildings       = v_buildings,
         property_total_number_of_units = v_units::numeric,
         property_total_units           = v_units
   where p.id = p_property_id
   returning p.property_account_id into v_account_id;

  -- An opportunity is a program application for the whole property, so its unit
  -- count mirrors the property's dwelling-unit total.
  update opportunities o
     set opportunity_total_number_of_units = v_units,
         opportunity_total_units           = v_units
   where o.property_id = p_property_id and not o.opportunity_is_deleted
     and (o.opportunity_total_number_of_units is distinct from v_units
          or o.opportunity_total_units is distinct from v_units);

  perform recompute_account_rollups(v_account_id);
end;
$function$;

create or replace function public.recompute_account_rollups(p_account_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_open_id uuid;
  v_won_id  uuid;
  v_dwelling uuid;
begin
  if p_account_id is null then return; end if;

  select id into v_open_id from picklist_values
   where picklist_object='opportunities' and picklist_field='opportunity_status'
     and picklist_value='Open' limit 1;
  select id into v_won_id from picklist_values
   where picklist_object='opportunities' and picklist_field='opportunity_status'
     and picklist_value='Won' limit 1;
  select id into v_dwelling from picklist_values
   where picklist_object='units' and picklist_field='record_type'
     and picklist_value='Dwelling Unit' limit 1;

  update accounts a
     set account_total_number_of_properties = coalesce((
           select count(*)::int from properties p
            where p.property_account_id = p_account_id and not p.property_is_deleted), 0),
         account_total_number_of_buildings = coalesce((
           select count(*)::int from buildings b
             join properties p on p.id = b.property_id and not p.property_is_deleted
            where p.property_account_id = p_account_id and not b.building_is_deleted), 0),
         account_total_number_of_units = coalesce((
           select count(*)::int from units u
             join buildings b  on b.id = u.building_id        and not b.building_is_deleted
             join properties p on p.id = b.property_id        and not p.property_is_deleted
            where p.property_account_id = p_account_id and not u.unit_is_deleted
              and u.unit_record_type = v_dwelling), 0),
         account_number_of_opportunities = coalesce((
           select count(*)::int from opportunities o
            where o.opportunity_account_id = p_account_id and not o.opportunity_is_deleted), 0),
         account_number_of_open_opportunities = coalesce((
           select count(*)::int from opportunities o
            where o.opportunity_account_id = p_account_id and not o.opportunity_is_deleted
              and o.opportunity_status = v_open_id), 0),
         account_number_of_won_opportunities = coalesce((
           select count(*)::int from opportunities o
            where o.opportunity_account_id = p_account_id and not o.opportunity_is_deleted
              and o.opportunity_status = v_won_id), 0),
         account_amount_of_open_opportunities = coalesce((
           select sum(o.opportunity_amount) from opportunities o
            where o.opportunity_account_id = p_account_id and not o.opportunity_is_deleted
              and o.opportunity_status = v_open_id), 0)
   where a.id = p_account_id;
end;
$function$;

-- New opportunities (or an opportunity re-pointed at a property) pick up the
-- property's current dwelling-unit total immediately, without waiting for a
-- unit change to fire the rollup chain.
create or replace function public.set_opportunity_unit_counts()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_units int;
begin
  if NEW.property_id is null then return NEW; end if;
  select coalesce(p.property_total_units, 0) into v_units
    from properties p where p.id = NEW.property_id;
  NEW.opportunity_total_number_of_units := v_units;
  NEW.opportunity_total_units := v_units;
  return NEW;
end;
$function$;

drop trigger if exists trg_opportunity_unit_counts on opportunities;
create trigger trg_opportunity_unit_counts
  before insert or update of property_id on opportunities
  for each row execute function set_opportunity_unit_counts();

revoke all on function public.recompute_building_rollups(uuid) from public, anon, authenticated;
revoke all on function public.recompute_property_rollups(uuid) from public, anon, authenticated;
revoke all on function public.recompute_account_rollups(uuid) from public, anon, authenticated;
revoke all on function public.set_opportunity_unit_counts() from public, anon, authenticated;

-- 4) Backfill existing units' record types, then recompute every rollup -----
do $$
declare
  v_dwelling uuid; v_mech uuid; v_attic uuid; v_hall uuid; v_common uuid; v_office uuid; v_standard uuid;
  r record;
begin
  select id into v_dwelling from picklist_values where picklist_object='units' and picklist_field='record_type' and picklist_value='Dwelling Unit' limit 1;
  select id into v_mech     from picklist_values where picklist_object='units' and picklist_field='record_type' and picklist_value='Mechanical Room' limit 1;
  select id into v_attic    from picklist_values where picklist_object='units' and picklist_field='record_type' and picklist_value='Attic Space' limit 1;
  select id into v_hall     from picklist_values where picklist_object='units' and picklist_field='record_type' and picklist_value='Hallway' limit 1;
  select id into v_common   from picklist_values where picklist_object='units' and picklist_field='record_type' and picklist_value='Common Area' limit 1;
  select id into v_office   from picklist_values where picklist_object='units' and picklist_field='record_type' and picklist_value='Office' limit 1;
  select id into v_standard from picklist_values where picklist_object='units' and picklist_field='record_type' and picklist_value='standard' limit 1;

  -- Classify from the unit designation. A numbered/lettered unit is a dwelling;
  -- worded spaces map to their space type. Only fills unset or legacy-'standard'
  -- rows — never overrides a record type an admin has already chosen.
  update units u set unit_record_type = case
      when u.unit_number ~* 'attic'                                                              then v_attic
      when u.unit_number ~* '(mechanical|boiler|furnace|utility|mechanicals)'                    then v_mech
      when u.unit_number ~* '(hallway|corridor|stair|stairwell|breezeway)'                        then v_hall
      when u.unit_number ~* '(office|leasing|management|manager)'                                 then v_office
      when u.unit_number ~* '(laundry|storage|community|common|lobby|lounge|trash|garbage|elevator|electrical|janitor|mail|garage|basement|roof)' then v_common
      else v_dwelling
    end
   where u.unit_is_deleted is not true
     and (u.unit_record_type is null or u.unit_record_type = v_standard);

  -- Recompute rollups for every building that has units (cascades to property,
  -- account, and opportunities).
  for r in select distinct building_id from units where unit_is_deleted is not true and building_id is not null loop
    perform recompute_building_rollups(r.building_id);
  end loop;
end;
$$;

-- Retire the legacy placeholder "standard" unit record type: all units have
-- been reclassified onto the six real types, so it should no longer appear in
-- the record-type picker.
update picklist_values
   set picklist_is_active = false
 where picklist_object='units' and picklist_field='record_type' and picklist_value='standard';

-- 5) Help article -----------------------------------------------------------
insert into help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published, ha_created_by)
select gen_random_uuid(), 'HA-00150', 'unit-record-types-and-dwelling-unit-counts',
 'Unit Record Types & the Dwelling-Unit Count',
 'Units are classified by record type. Only Dwelling Units count toward the building, property, account, and opportunity "number of units" totals.',
$md$## Why units include more than apartments

A **unit** in LEAP represents any distinct space in a building that we may need to
document or issue a work order against — not only the apartments people live in.
Mechanical rooms, attics, hallways, offices, and other common areas are created as
units too, so field crews can attach photos, work steps, and work orders to them.

Because of that, a raw count of unit records is **not** the same as the number of
rentable homes. A building with 11 apartments plus an attic, a mechanical room, two
hallways, an office, and a laundry room has 17 unit records but **11 dwelling units**.

## Unit record types

Every unit has a **record type** that says what kind of space it is:

| Record type | Counts as a unit? |
|---|---|
| **Dwelling Unit** | **Yes** — a lived-in rental home |
| Mechanical Room | No |
| Attic Space | No |
| Hallway | No |
| Common Area | No |
| Office | No |

Each record type has its own page layout (Setup → Page Layouts → Units), so the
detail page for a Mechanical Room can differ from a Dwelling Unit if you want.

## What the record type controls

Only units with the **Dwelling Unit** record type are counted in the "number of
units" rollups:

- **Building** → Number of Units / Total Units
- **Property** → Total Number of Units
- **Account** → Total Number of Units
- **Opportunity** → Total Number of Units (mirrors its property's dwelling total)

The bedroom, bathroom, and average-square-footage rollups on a building are also
computed from dwelling units only. Common-area units never inflate these numbers,
but they still appear in the Units related list and can still carry work orders.

## Setting a unit's record type

Pick the record type when you create the unit (the Record Type prompt on the new-unit
screen). To change it later, use **Change Record Type** on the unit. The counts
recalculate automatically the moment a unit's record type, building, or deletion state
changes — there is nothing to refresh by hand.

## A note on existing units

Units that existed before record types were introduced were classified automatically
from their unit number: numbered or lettered units (1, 2, A, B, …) became **Dwelling
Units**, and worded spaces (Attic, Mechanical Room, Office, hallways, laundry, …) were
mapped to the matching space type. Review any unit whose classification looks wrong and
correct it with Change Record Type.
$md$,
 'Records', 'internal', true,
 (select ha_created_by from help_articles where ha_created_by is not null order by ha_created_at desc limit 1)
where not exists (select 1 from help_articles where ha_record_number='HA-00150');

notify pgrst, 'reload schema';
