-- Extend the reorder_junction_rows allowlist to cover the page-layout
-- editor's drag-and-drop reorder of sections and widgets. The old allowlist
-- only had work_plan_template_entries — adding page_layout_sections.section_order
-- and page_layout_widgets.widget_position so admins can rearrange sections
-- and widgets inline. The two-phase staging-then-settle pattern is preserved
-- so the per-section UNIQUE constraint holds during the swap.

CREATE OR REPLACE FUNCTION public.reorder_junction_rows(p_table text, p_order_field text, p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_allowed_tables text[] := ARRAY[
    'work_plan_template_entries',
    'page_layout_sections',
    'page_layout_widgets'
  ];
  v_allowed_fields text[] := ARRAY[
    'wpte_execution_order',
    'section_order',
    'widget_position'
  ];
  v_count          integer;
BEGIN
  IF p_table IS NULL OR p_order_field IS NULL OR p_ids IS NULL THEN
    RAISE EXCEPTION 'reorder_junction_rows: table, order field, and ids are required';
  END IF;

  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'reorder_junction_rows: table % is not in the allowed list', p_table;
  END IF;
  IF NOT (p_order_field = ANY(v_allowed_fields)) THEN
    RAISE EXCEPTION 'reorder_junction_rows: field % is not in the allowed list', p_order_field;
  END IF;

  IF array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE format(
    'UPDATE %I AS t
        SET %I = -s.new_order
       FROM (SELECT unnest($1::uuid[]) AS id,
                    generate_subscripts($1::uuid[], 1) AS new_order) s
      WHERE t.id = s.id',
    p_table, p_order_field
  ) USING p_ids;

  EXECUTE format(
    'UPDATE %I AS t
        SET %I = s.new_order
       FROM (SELECT unnest($1::uuid[]) AS id,
                    generate_subscripts($1::uuid[], 1) AS new_order) s
      WHERE t.id = s.id',
    p_table, p_order_field
  ) USING p_ids;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
