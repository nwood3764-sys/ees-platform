-- The Outreach dashboard's STATE filter never reached its Pipeline by Stage
-- widget, and the dashboard gave no sign of it.
--
-- DSH-00010 carries five widgets: four on `properties` and one, Pipeline by
-- Stage, on `opportunities`. The filter names `property_state`, opportunities do
-- not have that column, and a filter a report has no field for is dropped. So
-- setting State to NC narrowed four widgets and left the funnel showing every
-- opportunity in every state — the two sitting side by side, looking alike.
--
-- Opportunities have carried `opportunity_state` since 2026-08-23, forced to
-- follow the property's state by trigger, so the equivalent is exact: the same
-- fact, spelled the way that object spells it.
--
-- Written by name, not by id: this is the one dashboard filter in the platform.

update public.dashboard_filters f
   set dfilt_field_map = jsonb_build_object(
         'properties',    'property_state',
         'opportunities', 'opportunity_state'
       ),
       updated_at = now()
  from public.dashboards d
 where d.id = f.dfilt_dashboard_id
   and d.dash_name = 'Outreach Dashboard'
   and f.dfilt_field_name = 'property_state'
   and f.is_deleted = false
   and d.is_deleted = false;

do $$
declare v_n int;
begin
  select count(*) into v_n
  from public.dashboard_filters f
  join public.dashboards d on d.id = f.dfilt_dashboard_id
  where d.dash_name = 'Outreach Dashboard' and f.is_deleted = false
    and f.dfilt_field_map ? 'opportunities';
  if v_n <> 1 then
    raise exception 'Expected exactly 1 mapped Outreach state filter, found %', v_n;
  end if;
end $$;
