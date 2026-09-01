-- A dashboard filter's dropdown shows names, not uuids.
--
-- dashboard_filter_distinct_values returned the column's raw text as both the
-- value and the label. On a plain text column (property_state) that is right.
-- On a picklist or lookup column — which is most of what anyone wants to filter
-- by: Status, Record Type, Program, Owner — the column holds a uuid, so the
-- control offered a list of uuids. That is the same defect the report groupings
-- had, and the reason the one filter in the platform (Outreach's STATE) is on a
-- text column: nothing else would have been usable.
--
-- The FILTER still compares the raw value, because that is what the column
-- holds. Only what the reader picks from changes.
--
-- Return shape gains `label`, so the function is dropped and recreated.

drop function if exists public.dashboard_filter_distinct_values(text, text, integer);

create function public.dashboard_filter_distinct_values(
  p_object text,
  p_field  text,
  p_limit  integer default 200
) returns table(value text, label text, n bigint)
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_soft_col  text;
  v_where     text := ' WHERE true';
  v_sql       text;
  v_ref_table text;
  v_ref_col   text;
  v_label_col text;
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = p_object) then
    raise exception 'Unknown object: %', p_object;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = p_object
                   and column_name = p_field) then
    raise exception 'Unknown column %.%', p_object, p_field;
  end if;

  select (ees_table_metadata(p_object)->>'is_deleted_column') into v_soft_col;
  if v_soft_col is not null then
    v_where := v_where || format(' AND t.%I = false', v_soft_col);
  end if;

  v_where := v_where
    || format(' AND t.%I IS NOT NULL', p_field)
    || format(' AND btrim(t.%I::text) <> ''''', p_field);

  -- Is this column a foreign key, and if so what does the target call itself?
  select cl_t.relname, att_t.attname
    into v_ref_table, v_ref_col
  from pg_constraint c
  join pg_class      cl_s  on cl_s.oid = c.conrelid
  join pg_namespace  ns_s  on ns_s.oid = cl_s.relnamespace
  join pg_attribute  att_s on att_s.attrelid = c.conrelid and att_s.attnum = c.conkey[1]
  join pg_class      cl_t  on cl_t.oid = c.confrelid
  join pg_attribute  att_t on att_t.attrelid = c.confrelid and att_t.attnum = c.confkey[1]
  where c.contype = 'f'
    and ns_s.nspname = 'public'
    and cl_s.relname = p_object
    and att_s.attname = p_field
    and array_length(c.conkey, 1) = 1
  limit 1;

  if v_ref_table is not null then
    if v_ref_table = 'picklist_values' then
      v_label_col := 'picklist_label';
    else
      -- The referenced table's own name column, in declaration order — the same
      -- rule the report engine uses to label a lookup.
      select column_name into v_label_col
      from information_schema.columns
      where table_schema = 'public' and table_name = v_ref_table
        and (column_name = 'name' or column_name like '%\_name')
      order by ordinal_position
      limit 1;
    end if;
  end if;

  if v_label_col is null then
    v_sql := format(
      'SELECT t.%I::text AS value, t.%I::text AS label, COUNT(*)::bigint AS n'
      || ' FROM %I t%s GROUP BY t.%I ORDER BY n DESC, value ASC LIMIT %s',
      p_field, p_field, p_object, v_where, p_field, greatest(p_limit, 1)
    );
  else
    -- LEFT JOIN, and the raw value as the fallback label: a referenced row the
    -- caller cannot see under RLS must not remove the value from the list, or
    -- the control would quietly offer fewer choices than the data holds.
    v_sql := format(
      'SELECT t.%I::text AS value, COALESCE(MAX(r.%I::text), t.%I::text) AS label,'
      || ' COUNT(*)::bigint AS n'
      || ' FROM %I t LEFT JOIN %I r ON r.%I = t.%I%s'
      || ' GROUP BY t.%I ORDER BY n DESC, label ASC LIMIT %s',
      p_field, v_label_col, p_field,
      p_object, v_ref_table, v_ref_col, p_field, v_where,
      p_field, greatest(p_limit, 1)
    );
  end if;

  return query execute v_sql;
end;
$function$;

-- Re-issue grants after the DROP/CREATE. anon is deliberately NOT granted: a
-- dashboard is an internal surface, and the previous grant only ever returned
-- what RLS let anon see, which is nothing worth offering.
revoke all on function public.dashboard_filter_distinct_values(text, text, integer) from public;
revoke all on function public.dashboard_filter_distinct_values(text, text, integer) from anon;
grant execute on function public.dashboard_filter_distinct_values(text, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
