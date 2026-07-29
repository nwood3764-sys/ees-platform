-- Fix: Enrollments related-list widgets still list the dropped `enrollment_site_address`
-- column, so the page-layout validator (validate_page_layout_widget_config, related_list
-- branch) rejects any save of a Property or Opportunity layout that carries the
-- "Enrollments" related list — "related_list column enrollment_site_address does not
-- exist on child table enrollments".
--
-- Root cause: migration 20260729031631 re-pointed the copied enrollment_* fields to live
-- Property references, and 20260729171520 dropped the physical columns — but that rewrite
-- only touched `field_group` widgets. The `related_list` column configs were missed, so 12
-- widgets (properties + opportunities layouts) still name the dropped column.
--
-- Faithful, display-identical fix: replace the plain `enrollment_site_address` text column
-- with a `lookup` column keyed on the enrollment's own `property_id` FK, resolving the same
-- value (properties.property_street) live instead of from the retired copy. Order and the
-- "Property Address" label are preserved. The validator only requires the column `name`
-- (`property_id`) to be a real column on the child (enrollments), which it is.

WITH tgt AS (
  SELECT w.id, w.widget_config
  FROM public.page_layout_widgets w
  JOIN public.page_layouts pl ON pl.id = w.page_layout_id
  WHERE pl.is_deleted IS NOT TRUE
    AND w.is_deleted IS NOT TRUE
    AND w.widget_type = 'related_list'
    AND w.widget_config->>'table' = 'enrollments'
    AND w.widget_config ? 'columns'
),
rebuilt AS (
  SELECT t.id,
    jsonb_set(t.widget_config, '{columns}', (
      SELECT jsonb_agg(
        CASE
          WHEN e.elem->>'name' = 'enrollment_site_address'
          THEN jsonb_build_object(
            'name',         'property_id',
            'type',         'lookup',
            'label',        COALESCE(NULLIF(e.elem->>'label',''), 'Property Address'),
            'fk_column',    'property_id',
            'lookup_table', 'properties',
            'lookup_field', 'property_street'
          )
          ELSE e.elem
        END
        ORDER BY e.ord
      )
      FROM jsonb_array_elements(t.widget_config->'columns') WITH ORDINALITY AS e(elem, ord)
    )) AS new_config
  FROM tgt t
)
UPDATE public.page_layout_widgets w
SET widget_config = r.new_config, updated_at = now()
FROM rebuilt r
WHERE r.id = w.id
  AND r.new_config IS DISTINCT FROM w.widget_config;

NOTIFY pgrst, 'reload schema';
