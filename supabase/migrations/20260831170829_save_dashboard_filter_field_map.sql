-- save_dashboard_children now persists a filter's per-object field map.
--
-- Same body as before apart from the two new lines: dfilt_field_map is written
-- from the payload's `field_map`, NULL when absent. Re-issued whole rather than
-- patched, because the function replaces a dashboard's widgets AND filters in
-- one transaction and must stay a single definition.

create or replace function public.save_dashboard_children(
  p_dashboard_id uuid,
  p_widgets      jsonb,
  p_filters      jsonb,
  p_columns      integer
) returns void
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_uid  uuid := public.current_app_user_id();
  v_row  jsonb;
  v_i    int;
  v_cols int := greatest(1, coalesce(p_columns, 3));
begin
  if p_dashboard_id is null then
    raise exception 'save_dashboard_children: dashboard id is required' using errcode = '22023';
  end if;

  update public.dashboard_widgets set is_deleted = true, updated_by = v_uid where dw_dashboard_id    = p_dashboard_id and is_deleted = false;
  update public.dashboard_filters set is_deleted = true, updated_by = v_uid where dfilt_dashboard_id = p_dashboard_id and is_deleted = false;

  v_i := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_widgets, '[]'::jsonb))
  loop
    insert into public.dashboard_widgets (
      dw_dashboard_id, dw_report_id, dw_title, dw_widget_type,
      dw_position_row, dw_position_col, dw_width, dw_height,
      dw_widget_config, created_by, updated_by
    ) values (
      p_dashboard_id,
      (v_row->>'report_id')::uuid,
      nullif(v_row->>'title', ''),
      coalesce(nullif(v_row->>'widget_type', ''), 'table'),
      (v_i / v_cols),
      (v_i % v_cols),
      coalesce((v_row->>'width')::int, 1),
      coalesce((v_row->>'height')::int, 1),
      coalesce(nullif(v_row->'widget_config', 'null'::jsonb), '{}'::jsonb),
      v_uid, v_uid
    );
    v_i := v_i + 1;
  end loop;

  v_i := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb))
  loop
    insert into public.dashboard_filters (
      dfilt_dashboard_id, dfilt_label, dfilt_field_name, dfilt_operator,
      dfilt_default_value, dfilt_options, dfilt_field_map, dfilt_display_order,
      created_by, updated_by
    ) values (
      p_dashboard_id,
      v_row->>'label',
      v_row->>'field_name',
      coalesce(nullif(v_row->>'operator', ''), 'equals'),
      nullif(v_row->'default_value', 'null'::jsonb),
      coalesce(nullif(v_row->'options', 'null'::jsonb), '[]'::jsonb),
      -- Per-object equivalents. Absent on every filter written before this, and
      -- NULL is the right value there: the filter then reaches only the objects
      -- that spell its column the same way, which is exactly what it did.
      nullif(v_row->'field_map', 'null'::jsonb),
      v_i,
      v_uid, v_uid
    );
    v_i := v_i + 1;
  end loop;
end$function$;
