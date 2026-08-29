-- A calculated field is a label and a formula. A row with neither is not a
-- field, and must not be stored as one.
--
-- Nicholas, 2026-08-29, on a column headed "(CALC) ƒ" that showed an em dash on
-- every row: "why did this calc field? Now how do I get rid of it?"
--
-- "+ Add Calculated Field" appends an EMPTY row, and save_report_children
-- inserted it as-is: no label (so the viewer printed its "(calc)" placeholder as
-- the column heading) and no expression (so every cell evaluated to nothing).
-- Saving again re-created it, since it was still in the editor — RPT-00045
-- collected twelve of them in one afternoon.
--
-- The client now drops a never-filled row and refuses to save a half-filled one.
-- This is the backstop, so no other writer can put a nameless column on a
-- report:
--
--   * both blank  → skipped, silently. Nothing was typed; nothing is lost.
--   * one blank   → the whole save is refused, naming what is missing. That row
--                   is someone's unfinished work and deleting it quietly would
--                   throw the work away.
--
-- The existing soft-deleted blanks are left where they are: they are history,
-- and history is not rewritten to make a new rule look tidy.

CREATE OR REPLACE FUNCTION public.save_report_children(
  p_report_id uuid,
  p_filters jsonb,
  p_groupings jsonb,
  p_calculated_fields jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := public.current_app_user_id();
  v_row jsonb;
  v_i   int;
  v_label text;
  v_expr  text;
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
      rgr_show_subtotal, rgr_date_granularity,
      rgr_group_filter_op, rgr_group_filter_value, created_by, updated_by
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
      nullif(v_row->>'group_filter_op', ''),
      nullif(v_row->>'group_filter_value', '')::numeric,
      v_uid, v_uid
    );
  end loop;

  v_i := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_calculated_fields, '[]'::jsonb))
  loop
    v_label := btrim(coalesce(v_row->>'label', ''));
    v_expr  := btrim(coalesce(v_row->>'expression', ''));

    -- Added and never filled in: not a field. Skip it without comment.
    if v_label = '' and v_expr = '' then
      continue;
    end if;

    -- Half authored: refuse the save rather than discard the half that exists.
    if v_label = '' then
      raise exception 'A calculated field has a formula (%) but no label. Give it a label, or remove the row.', left(v_expr, 60)
        using errcode = '23514';
    end if;
    if v_expr = '' then
      raise exception 'Calculated field "%" has no formula. Write one, or remove the row.', v_label
        using errcode = '23514';
    end if;

    insert into public.report_calculated_fields (
      rcf_report_id, rcf_label, rcf_scope, rcf_expression, rcf_data_type,
      rcf_format_options, rcf_display_order, rcf_grouping_level, created_by, updated_by
    ) values (
      p_report_id,
      v_label,
      coalesce(nullif(v_row->>'scope', ''), 'row'),
      v_expr,
      coalesce(nullif(v_row->>'data_type', ''), 'number'),
      coalesce(nullif(v_row->'format_options', 'null'::jsonb), '{}'::jsonb),
      v_i,
      nullif(v_row->>'grouping_level', '')::int,
      v_uid, v_uid
    );
    v_i := v_i + 1;
  end loop;
end$function$;

NOTIFY pgrst, 'reload schema';
