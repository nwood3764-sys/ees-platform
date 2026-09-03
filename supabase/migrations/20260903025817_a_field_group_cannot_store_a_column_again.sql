-- ---------------------------------------------------------------------------
-- A field group cannot store a `column` again
-- ---------------------------------------------------------------------------
-- The one-time strip in 20260903023916 is not enough on its own: anything that
-- WRITES a field group could put the second fact back — a browser tab still
-- running the old bundle, a migration authored in a session running alongside
-- this one (four landed on prod within seven minutes of that migration, two of
-- them editing page layouts), or a seed replayed on a branch database in a
-- different order.
--
-- `column` was read by the record page as a pinned slot, and that is what
-- produced the staggered rows Nicholas reported: one field pinned to column 2
-- ahead of one pinned to column 1, and CSS grid could not place the second
-- beside the first, so it dropped to the next row and left the slot next to
-- each of them empty. ONE row carrying it is enough to reopen the defect on
-- that layout, silently.
--
-- So the invariant enforces itself. A field's index is its position; the column
-- is derived at render time by src/lib/fieldGroupLayout.js and stored nowhere.
--
-- This STRIPS on the way in rather than raising: a save that is right in every
-- other respect should not be refused over a key the platform no longer reads,
-- and an admin shown that error would have no way to act on it.
-- ---------------------------------------------------------------------------

create or replace function public.strip_field_group_derived_column()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
  v_f   jsonb;
begin
  if new.widget_type <> 'field_group'
     or jsonb_typeof(new.widget_config->'fields') <> 'array' then
    return new;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(new.widget_config->'fields') f where f ? 'column'
  ) then
    return new;
  end if;

  v_out := '[]'::jsonb;
  for v_f in select f from jsonb_array_elements(new.widget_config->'fields') f loop
    v_out := v_out || jsonb_build_array(v_f - 'column');
  end loop;
  new.widget_config := jsonb_set(new.widget_config, '{fields}', v_out);
  return new;
end $$;

-- SECURITY INVOKER deliberately: it reads and rewrites only the row being
-- written, so it needs no elevated rights, and a definer trigger function would
-- need its EXECUTE revoked in the same migration to avoid an advisor lint
-- (2026-08-31). Sorts before trg_validate_page_layout_widget_config, so the
-- validator only ever sees the shape the platform actually stores.
drop trigger if exists trg_0_strip_field_group_derived_column on public.page_layout_widgets;
create trigger trg_0_strip_field_group_derived_column
  before insert or update on public.page_layout_widgets
  for each row execute function public.strip_field_group_derived_column();

-- Re-strip whatever is stored, so the invariant holds however the migrations
-- are REPLAYED and not just in the order they happened to reach production. Two
-- migrations authored in parallel sessions
-- (…023940_the_opportunity_shows_the_equipment_it_installs and
--  …025640_approved_models_are_managed_on_the_product) build field groups with
-- an explicit `column`; on production they ran before …023916 stripped it, but
-- by FILENAME they sort after it, so a branch database replaying in file order
-- would end up carrying it again and the assertion below would fail the replay.
-- A no-op on production, where the count is already zero.
update public.page_layout_widgets w
   set widget_config = jsonb_set(
         w.widget_config, '{fields}',
         (select coalesce(jsonb_agg(f - 'column' order by ord), '[]'::jsonb)
            from jsonb_array_elements(w.widget_config->'fields') with ordinality t(f, ord)))
 where w.widget_type = 'field_group'
   -- Live rows only. A soft-deleted widget is a recycle-bin record that nothing
   -- renders, and touching one re-runs validate_page_layout_widget_config()
   -- against a layout that was deleted BECAUSE it referenced a column that no
   -- longer exists — which is exactly what this hit on production
   -- ("work_order_assigned_to does not exist on table work_orders"). The
   -- invariant is about what the record page draws.
   and w.is_deleted is not true
   and jsonb_typeof(w.widget_config->'fields') = 'array'
   and exists (
     select 1 from jsonb_array_elements(w.widget_config->'fields') f where f ? 'column'
   );

-- ── Prove it, then leave nothing behind ────────────────────────────────────
-- block_hard_delete() refuses a cleanup DELETE, so the probe raises to unwind
-- its own savepoint rather than inserting a row that then has to be removed.
do $$
declare
  v_layout uuid;
  v_section uuid;
  v_stored jsonb;
begin
  select w.page_layout_id, w.section_id into v_layout, v_section
  from public.page_layout_widgets w
  where w.widget_type = 'field_group' and w.is_deleted is not true
  limit 1;

  begin
    insert into public.page_layout_widgets
      (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_config)
    values (v_layout, v_section, 'field_group', 'column strip probe', 1, 999,
            jsonb_build_object('fields', jsonb_build_array(
              jsonb_build_object('name', 'id', 'type', 'text', 'label', 'Probe', 'column', 2))))
    returning widget_config->'fields' into v_stored;

    if v_stored -> 0 ? 'column' then
      raise exception 'a field group still stored a `column` after the trigger ran: %', v_stored;
    end if;
    if (v_stored -> 0 ->> 'label') <> 'Probe' then
      raise exception 'the trigger altered more than the derived column: %', v_stored;
    end if;
    raise exception 'rollback the probe';
  exception when others then
    if sqlerrm <> 'rollback the probe' then raise; end if;
  end;
end $$;

do $$
declare v_left int;
begin
  select count(*) into v_left
  from public.page_layout_widgets w, jsonb_array_elements(coalesce(w.widget_config->'fields','[]'::jsonb)) f
  where w.widget_type = 'field_group' and w.is_deleted is not true and (f ? 'column');
  if v_left > 0 then
    raise exception '% field(s) still carry a derived `column`', v_left;
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'page_layout_widgets'
      and t.tgname = 'trg_0_strip_field_group_derived_column'
      and not t.tgisinternal
  ) then
    raise exception 'the guard trigger was not installed';
  end if;
end $$;
