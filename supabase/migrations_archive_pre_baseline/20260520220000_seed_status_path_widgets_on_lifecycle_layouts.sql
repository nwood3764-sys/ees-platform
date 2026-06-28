-- =====================================================================
-- Seed status_path widgets on the default page layouts for every object
-- with a meaningful status lifecycle. One widget per (layout, status field).
-- work_orders gets only work_order_status here; work_order_approval_status
-- can be added per-layout via the Page Layout Builder if a given record
-- type needs it.
-- =====================================================================

WITH targets AS (
  SELECT pl.id AS layout_id, pl.page_layout_object AS obj, sf AS status_field
  FROM public.page_layouts pl
  CROSS JOIN LATERAL (
    SELECT unnest(CASE pl.page_layout_object
      WHEN 'projects'                 THEN ARRAY['project_status']
      WHEN 'opportunities'            THEN ARRAY['opportunity_status']
      WHEN 'work_orders'              THEN ARRAY['work_order_status']
      WHEN 'incentive_applications'   THEN ARRAY['ia_status']
      WHEN 'project_payment_requests' THEN ARRAY['ppr_status']
      ELSE ARRAY[]::text[]
    END) AS sf
  ) AS fields
  WHERE pl.page_layout_type = 'record_detail'
    AND pl.is_deleted = false
    AND pl.page_layout_object IN ('projects','opportunities','work_orders','incentive_applications','project_payment_requests')
),
first_sections AS (
  SELECT DISTINCT ON (page_layout_id) page_layout_id, id AS section_id
  FROM public.page_layout_sections
  WHERE is_deleted = false
  ORDER BY page_layout_id, section_order ASC, created_at ASC
),
to_insert AS (
  SELECT t.layout_id, t.status_field, fs.section_id
  FROM targets t
  JOIN first_sections fs ON fs.page_layout_id = t.layout_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.page_layout_widgets w
    WHERE w.page_layout_id = t.layout_id
      AND w.widget_type = 'status_path'
      AND w.is_deleted = false
      AND w.widget_config->>'status_field' = t.status_field
  )
)
INSERT INTO public.page_layout_widgets (
  page_layout_widget_record_number,
  page_layout_id, section_id, widget_type, widget_title,
  widget_column, widget_position, widget_size, widget_config,
  widget_is_user_customizable, widget_is_required, is_deleted
)
SELECT
  '',
  layout_id, section_id, 'status_path',
  'Status Path',
  1, 0, 'full',
  jsonb_build_object(
    'status_field',         status_field,
    'show_guidance',        true,
    'show_completed_count', true
  ),
  false, false, false
FROM to_insert;
