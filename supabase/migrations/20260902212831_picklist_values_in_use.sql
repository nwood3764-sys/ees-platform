-- Which picklist values an object's records actually carry.
--
-- Deactivating a picklist value means "nobody may choose this on a new
-- record". It never meant "nobody may find the records that already carry it"
-- -- but that is what it did: every picklist dropdown in LEAP is fed by the
-- active-only list, and the list-view FILTER used the same list as the
-- EDITORS. So the Technicians tab (the contacts object list) showed seven
-- contacts reading "Technician" under Contact Record Type while the filter for
-- that column offered five values, none of them Technician (Nicholas,
-- 2026-09-02). Retiring a value silently hid its records from search.
--
-- This answers the one question the filter needs and the editors must NOT ask:
-- which values are still carried by live records. A retired value in use can
-- then be offered for FILTERING while staying unavailable for CHOOSING.
--
-- SECURITY INVOKER deliberately: the answer is derived from the caller's own
-- readable rows, so a state-scoped user cannot learn that a value exists on
-- records they cannot see. anon is revoked -- this is an internal helper, not
-- a public API.

create or replace function public.picklist_values_in_use(p_object text, p_field text)
returns table (picklist_value_id uuid)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_col     text;
  v_del_col text;
  v_sql     text;
begin
  if p_object is null or p_field is null then
    return;
  end if;

  -- The object must be a real base table. Anything else and we return nothing,
  -- which leaves the caller on the active-only list it used before.
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = p_object and table_type = 'BASE TABLE'
  ) then
    return;
  end if;

  -- picklist_field is stored inconsistently across (and within) tables: some
  -- rows carry the bare field ('record_type'), others the full column name
  -- ('work_order_status'). Accept both spellings, matched on the column's real
  -- name rather than a hand-maintained table -> prefix map. An exact match wins
  -- over a prefixed one; shortest prefixed name wins among the rest.
  select c.column_name into v_col
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name   = p_object
    and c.data_type    = 'uuid'
    and (c.column_name = p_field
         or right(c.column_name, length(p_field) + 1) = '_' || p_field)
  order by (c.column_name = p_field) desc, length(c.column_name)
  limit 1;

  if v_col is null then
    return;
  end if;

  -- Soft-deleted rows are in the recycle bin, not in the list the filter runs
  -- against, so a value carried only by deleted records is not "in use".
  select c.column_name into v_del_col
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name   = p_object
    and c.data_type    = 'boolean'
    and right(c.column_name, 10) = 'is_deleted'
  order by length(c.column_name)
  limit 1;

  v_sql := format('select distinct t.%I from public.%I t where t.%I is not null',
                  v_col, p_object, v_col);
  if v_del_col is not null then
    v_sql := v_sql || format(' and t.%I is not true', v_del_col);
  end if;

  return query execute v_sql;
end;
$$;

comment on function public.picklist_values_in_use(text, text) is
  'Picklist value ids the caller can see on live records of p_object for p_field. Feeds the list-view FILTER so a retired value that records still carry stays findable; never feeds an editor, which must keep offering active values only.';

-- A DROP/CREATE resets grants, so they are re-issued here every time.
revoke all on function public.picklist_values_in_use(text, text) from public;
revoke all on function public.picklist_values_in_use(text, text) from anon;
grant execute on function public.picklist_values_in_use(text, text) to authenticated;

-- Prove it against the reported case rather than assuming it.
do $verify$
declare
  v_technician uuid;
  v_team_lead  uuid;
  v_in_use     uuid[];
begin
  select id into v_technician from picklist_values
   where picklist_object = 'contacts' and picklist_field = 'record_type'
     and picklist_value = 'TECHNICIAN';
  select id into v_team_lead from picklist_values
   where picklist_object = 'contacts' and picklist_field = 'record_type'
     and picklist_value = 'TEAM-LEAD';

  select array_agg(picklist_value_id)
    into v_in_use
    from public.picklist_values_in_use('contacts', 'record_type');

  if v_technician is null or not (v_technician = any (v_in_use)) then
    raise exception 'picklist_values_in_use did not report TECHNICIAN, the retired contact record type seven live contacts carry';
  end if;

  -- The negative control: a retired value nothing carries must NOT come back,
  -- or the function is simply listing every value and proves nothing.
  if v_team_lead is not null and v_team_lead = any (v_in_use) then
    raise exception 'picklist_values_in_use reported TEAM-LEAD, which no live contact carries';
  end if;

  -- And it must resolve a column named exactly as the field, not only a
  -- prefixed one, or every *_status filter silently keeps the old behaviour.
  if not exists (select 1 from public.picklist_values_in_use('work_orders', 'work_order_status')) then
    raise exception 'picklist_values_in_use resolved no values for work_orders.work_order_status';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
