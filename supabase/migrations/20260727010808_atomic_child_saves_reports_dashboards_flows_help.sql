-- ============================================================================
-- Atomic child-record saves: reports, dashboards, flows, help-article anchors
-- (2026-07-27)
--
-- Same class of data-loss bug that wiped a page layout (PR #239): four builder
-- save paths soft-deleted (or HARD-deleted) a parent's child rows in one
-- request, then re-inserted the new set in SEPARATE requests. If any insert
-- failed partway, the delete had already committed and the children were lost.
--
-- Each function below does the delete + recreate inside a SINGLE transaction
-- (one function call = one transaction), so any failure rolls the whole thing
-- back and the existing children are left untouched. Modeled on
-- save_page_layout_from_canvas / save_home_page. All SECURITY INVOKER, so RLS
-- on the child tables still applies exactly as it did for the old client calls.
--
-- The parent rows (reports/dashboards/flows/help_articles themselves) are NOT
-- touched here: they are inserted/updated by a single atomic statement on the
-- client and were never at risk of loss. These functions own only the child
-- collections that were being delete-then-reinserted.
-- ============================================================================

-- ─── Reports: filters + groupings + calculated fields ───────────────────────
CREATE OR REPLACE FUNCTION public.save_report_children(
  p_report_id         uuid,
  p_filters           jsonb,
  p_groupings         jsonb,
  p_calculated_fields jsonb
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := public.current_app_user_id();
  v_row jsonb;
  v_i   int;
begin
  if p_report_id is null then
    raise exception 'save_report_children: report id is required' using errcode = '22023';
  end if;

  update public.report_filters          set is_deleted = true, updated_by = v_uid where rfilt_report_id = p_report_id and is_deleted = false;
  update public.report_groupings        set is_deleted = true, updated_by = v_uid where rgr_report_id   = p_report_id and is_deleted = false;
  update public.report_calculated_fields set is_deleted = true, updated_by = v_uid where rcf_report_id  = p_report_id and is_deleted = false;

  v_i := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb))
  loop
    v_i := v_i + 1;
    insert into public.report_filters (
      rfilt_report_id, rfilt_filter_index, rfilt_field_name, rfilt_field_table,
      rfilt_field_via_path, rfilt_operator, rfilt_value, rfilt_is_cross_filter,
      rfilt_cross_object, rfilt_cross_match, rfilt_cross_subfilters,
      rfilt_is_runtime_prompt, rfilt_runtime_label, rfilt_prompt_input_type,
      rfilt_prompt_options, created_by, updated_by
    ) values (
      p_report_id, v_i,
      nullif(v_row->>'field_name', ''),
      nullif(v_row->>'field_table', ''),
      nullif(v_row->'field_via_path', 'null'::jsonb),
      v_row->>'operator',
      nullif(v_row->'value', 'null'::jsonb),
      coalesce((v_row->>'is_cross_filter')::boolean, false),
      nullif(v_row->>'cross_object', ''),
      nullif(v_row->>'cross_match', ''),
      coalesce(nullif(v_row->'cross_subfilters', 'null'::jsonb), '[]'::jsonb),
      coalesce((v_row->>'is_runtime_prompt')::boolean, false),
      nullif(v_row->>'runtime_label', ''),
      coalesce(nullif(v_row->>'prompt_input_type', ''), 'text'),
      coalesce(nullif(v_row->'prompt_options', 'null'::jsonb), '[]'::jsonb),
      v_uid, v_uid
    );
  end loop;

  v_i := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_groupings, '[]'::jsonb))
  loop
    v_i := v_i + 1;
    insert into public.report_groupings (
      rgr_report_id, rgr_grouping_level, rgr_field_name, rgr_field_table,
      rgr_field_via_path, rgr_field_label, rgr_sort_direction, rgr_sort_by_aggregate,
      rgr_show_subtotal, rgr_date_granularity, created_by, updated_by
    ) values (
      p_report_id, v_i,
      v_row->>'field_name',
      nullif(v_row->>'field_table', ''),
      nullif(v_row->'field_via_path', 'null'::jsonb),
      nullif(v_row->>'field_label', ''),
      coalesce(nullif(v_row->>'sort_direction', ''), 'asc'),
      nullif(v_row->>'sort_by_aggregate', ''),
      coalesce((v_row->>'show_subtotal')::boolean, true),
      nullif(v_row->>'date_granularity', ''),
      v_uid, v_uid
    );
  end loop;

  v_i := 0;   -- rcf_display_order is 0-based in the original client code
  for v_row in select * from jsonb_array_elements(coalesce(p_calculated_fields, '[]'::jsonb))
  loop
    insert into public.report_calculated_fields (
      rcf_report_id, rcf_label, rcf_scope, rcf_expression, rcf_data_type,
      rcf_format_options, rcf_display_order, rcf_grouping_level, created_by, updated_by
    ) values (
      p_report_id,
      v_row->>'label',
      coalesce(nullif(v_row->>'scope', ''), 'row'),
      v_row->>'expression',
      coalesce(nullif(v_row->>'data_type', ''), 'number'),
      coalesce(nullif(v_row->'format_options', 'null'::jsonb), '{}'::jsonb),
      v_i,
      nullif(v_row->>'grouping_level', '')::int,
      v_uid, v_uid
    );
    v_i := v_i + 1;
  end loop;
end$function$;

-- ─── Dashboards: widgets + filters ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_dashboard_children(
  p_dashboard_id uuid,
  p_widgets      jsonb,
  p_filters      jsonb,
  p_columns      int
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

  v_i := 0;   -- 0-based index drives position + display order (matches client)
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
      dfilt_default_value, dfilt_options, dfilt_display_order, created_by, updated_by
    ) values (
      p_dashboard_id,
      v_row->>'label',
      v_row->>'field_name',
      coalesce(nullif(v_row->>'operator', ''), 'equals'),
      nullif(v_row->'default_value', 'null'::jsonb),
      coalesce(nullif(v_row->'options', 'null'::jsonb), '[]'::jsonb),
      v_i,
      v_uid, v_uid
    );
    v_i := v_i + 1;
  end loop;
end$function$;

-- ─── Flows: full ordered element list + linear/decision rewiring ─────────────
CREATE OR REPLACE FUNCTION public.save_flow_elements(
  p_flow_id  uuid,
  p_elements jsonb
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid      uuid := public.current_app_user_id();
  v_el       jsonb;
  v_branch   jsonb;
  v_branches jsonb;
  v_ids      uuid[] := '{}';
  v_els      jsonb[] := '{}';
  v_id       uuid;
  v_ord      int;
  v_tgt      text;
  v_tgt_id   uuid;
  v_n        int;
begin
  if p_flow_id is null then
    raise exception 'save_flow_elements: flow id is required' using errcode = '22023';
  end if;
  if v_uid is null then
    raise exception 'save_flow_elements: not authenticated' using errcode = '28000';
  end if;

  update public.flow_elements
     set is_deleted = true, updated_by = v_uid
   where fe_flow_id = p_flow_id and is_deleted = false;

  -- Insert in fe_order sequence, renumbering fe_order to a dense 0-based chain.
  v_ord := 0;
  for v_el in
    select value
    from jsonb_array_elements(coalesce(p_elements, '[]'::jsonb)) with ordinality as t(value, rn)
    order by (value->>'fe_order')::numeric nulls last, rn
  loop
    insert into public.flow_elements (
      fe_record_number, fe_flow_id, fe_element_type, fe_order, fe_label,
      fe_api_name, fe_config, fe_decision_branches, owner_id, created_by, updated_by
    ) values (
      '', p_flow_id,
      v_el->>'fe_element_type',
      v_ord,
      nullif(v_el->>'fe_label', ''),
      nullif(v_el->>'fe_api_name', ''),
      coalesce(nullif(v_el->'fe_config', 'null'::jsonb), '{}'::jsonb),
      '[]'::jsonb,
      v_uid, v_uid, v_uid
    )
    returning id into v_id;

    v_ids := array_append(v_ids, v_id);
    v_els := array_append(v_els, v_el);
    v_ord := v_ord + 1;
  end loop;

  v_n := coalesce(array_length(v_ids, 1), 0);

  -- Linear next-element pointers: element[k] -> element[k+1].
  for v_ord in 1 .. greatest(v_n - 1, 0) loop
    update public.flow_elements
       set fe_next_element_id = v_ids[v_ord + 1]
     where id = v_ids[v_ord];
  end loop;

  -- Resolve decision branches (target_order is the 0-based position in the
  -- ordered list; out-of-range/unset targets resolve to NULL and fall through).
  for v_ord in 1 .. v_n loop
    v_el := v_els[v_ord];
    if v_el->>'fe_element_type' <> 'decision' then
      continue;
    end if;

    v_branches := '[]'::jsonb;
    for v_branch in
      select value from jsonb_array_elements(coalesce(v_el->'fe_decision_branches', '[]'::jsonb))
    loop
      if v_branch->'condition'->>'field' is null then
        continue;
      end if;
      v_tgt := nullif(v_branch->>'target_order', '');
      v_tgt_id := case when v_tgt is not null then v_ids[(v_tgt)::int + 1] else null end;
      v_branches := v_branches || jsonb_build_array(jsonb_build_object(
        'condition', jsonb_build_object(
          'field', v_branch->'condition'->>'field',
          'op',    coalesce(nullif(v_branch->'condition'->>'op', ''), 'eq'),
          'value', v_branch->'condition'->'value'
        ),
        'next_element_id', v_tgt_id,
        'label', nullif(v_branch->>'label', '')
      ));
    end loop;

    if jsonb_array_length(v_branches) > 0 then
      update public.flow_elements
         set fe_decision_branches = v_branches
       where id = v_ids[v_ord];
    end if;
  end loop;
end$function$;

-- ─── Help article anchors (was a HARD delete + insert) ──────────────────────
CREATE OR REPLACE FUNCTION public.set_article_anchors(
  p_article_id uuid,
  p_anchors    jsonb
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := public.current_app_user_id();
  v_row jsonb;
  v_i   int;
  v_type text;
begin
  if p_article_id is null then
    raise exception 'set_article_anchors: article id is required' using errcode = '22023';
  end if;

  delete from public.help_article_anchors where haa_article_id = p_article_id;

  v_i := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_anchors, '[]'::jsonb))
  loop
    v_type := v_row->>'type';
    insert into public.help_article_anchors (
      haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field,
      haa_concept, haa_sort_order, haa_created_by
    ) values (
      p_article_id,
      v_type,
      case when v_type = 'route' then nullif(v_row->>'route', '') else null end,
      case when v_type in ('object', 'field') then nullif(v_row->>'object', '') else null end,
      case when v_type = 'field'  then nullif(v_row->>'field', '')  else null end,
      case when v_type = 'concept' then nullif(v_row->>'concept', '') else null end,
      coalesce((v_row->>'sort_order')::int, v_i),
      v_uid
    );
    v_i := v_i + 1;
  end loop;
end$function$;

REVOKE ALL ON FUNCTION public.save_report_children(uuid, jsonb, jsonb, jsonb)      FROM public, anon;
REVOKE ALL ON FUNCTION public.save_dashboard_children(uuid, jsonb, jsonb, int)     FROM public, anon;
REVOKE ALL ON FUNCTION public.save_flow_elements(uuid, jsonb)                      FROM public, anon;
REVOKE ALL ON FUNCTION public.set_article_anchors(uuid, jsonb)                     FROM public, anon;

GRANT EXECUTE ON FUNCTION public.save_report_children(uuid, jsonb, jsonb, jsonb)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_dashboard_children(uuid, jsonb, jsonb, int)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_flow_elements(uuid, jsonb)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_article_anchors(uuid, jsonb)                  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
