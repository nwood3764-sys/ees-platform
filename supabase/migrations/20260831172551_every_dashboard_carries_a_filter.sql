-- Nicholas, 2026-08-31: "all dashboards need the filter. I'm looking at the
-- enrollment dashboard. Do you see a filter there? I don't see it."
--
-- One dashboard in the platform had a filter. The other three had none, so
-- every reader saw one fixed view and the filter bar did not exist for them.
--
-- Each gets the filter its own widgets can actually answer — not one blanket
-- field pushed onto objects that do not carry it:
--
--   Enrollment Overview   → Status. All three widgets are enrollments, so it
--                           reaches every one. Enrollments carry NO state
--                           column (enrollment_payment_state is a payment
--                           status, not a US state), so a State filter here
--                           would have reached nothing at all.
--   Qualification Overview → Status. Both widgets are assessments.
--   Program Operations     → State, across properties and opportunities. Work
--                           orders, payment requests and receipts have no state
--                           column; those three widgets now say so on their own
--                           face rather than looking filtered.
--
-- No default value on any of them: a fresh filter that starts pinned to one
-- value hides records from a reader who never chose it.

do $$
declare
  v_dash uuid;
begin
  -- Enrollment Overview → Status
  select id into v_dash from public.dashboards
   where dash_name = 'Enrollment Overview' and is_deleted = false;
  if v_dash is not null and not exists (
      select 1 from public.dashboard_filters
       where dfilt_dashboard_id = v_dash and is_deleted = false) then
    insert into public.dashboard_filters (
      dfilt_dashboard_id, dfilt_label, dfilt_field_name, dfilt_operator,
      dfilt_options, dfilt_field_map, dfilt_display_order
    ) values (
      v_dash, 'Status', 'enrollment_status', 'equals',
      jsonb_build_object('source', 'distinct', 'object', 'enrollments', 'field', 'enrollment_status'),
      jsonb_build_object('enrollments', 'enrollment_status'),
      0
    );
  end if;

  -- Qualification Overview → Status
  select id into v_dash from public.dashboards
   where dash_name = 'Qualification Overview' and is_deleted = false;
  if v_dash is not null and not exists (
      select 1 from public.dashboard_filters
       where dfilt_dashboard_id = v_dash and is_deleted = false) then
    insert into public.dashboard_filters (
      dfilt_dashboard_id, dfilt_label, dfilt_field_name, dfilt_operator,
      dfilt_options, dfilt_field_map, dfilt_display_order
    ) values (
      v_dash, 'Status', 'assessment_status', 'equals',
      jsonb_build_object('source', 'distinct', 'object', 'assessments', 'field', 'assessment_status'),
      jsonb_build_object('assessments', 'assessment_status'),
      0
    );
  end if;

  -- Program Operations Overview → State
  select id into v_dash from public.dashboards
   where dash_name = 'Program Operations Overview' and is_deleted = false;
  if v_dash is not null and not exists (
      select 1 from public.dashboard_filters
       where dfilt_dashboard_id = v_dash and is_deleted = false) then
    insert into public.dashboard_filters (
      dfilt_dashboard_id, dfilt_label, dfilt_field_name, dfilt_operator,
      dfilt_options, dfilt_field_map, dfilt_display_order
    ) values (
      v_dash, 'State', 'property_state', 'equals',
      jsonb_build_object('source', 'distinct', 'object', 'properties', 'field', 'property_state'),
      jsonb_build_object('properties', 'property_state', 'opportunities', 'opportunity_state'),
      0
    );
  end if;
end $$;

-- Every dashboard now has at least one filter, and every filter names a column
-- that exists on the object it names.
do $$
declare v_bare int; v_bad int;
begin
  select count(*) into v_bare
  from public.dashboards d
  where d.is_deleted = false
    and exists (select 1 from public.dashboard_widgets w
                 where w.dw_dashboard_id = d.id and w.is_deleted = false)
    and not exists (select 1 from public.dashboard_filters f
                     where f.dfilt_dashboard_id = d.id and f.is_deleted = false);
  if v_bare > 0 then
    raise exception '% dashboard(s) still carry no filter', v_bare;
  end if;

  select count(*) into v_bad
  from public.dashboard_filters f
  cross join lateral jsonb_each_text(coalesce(f.dfilt_field_map, '{}'::jsonb)) m(obj, col)
  where f.is_deleted = false
    and m.col is not null
    and not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = m.obj
                       and c.column_name = m.col);
  if v_bad > 0 then
    raise exception '% filter mapping(s) name a column that does not exist', v_bad;
  end if;
end $$;
