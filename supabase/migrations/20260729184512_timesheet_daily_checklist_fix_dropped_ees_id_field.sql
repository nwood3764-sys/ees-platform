-- Fix: the Time Sheet Entry "Daily Checklist" field group references a column that
-- no longer exists — `tse_has_anura_id` — so validate_page_layout_widget_config
-- (field_group branch) rejects any save of that layout:
--   "field_group references column tse_has_anura_id which does not exist on table
--    time_sheet_entries".
--
-- Root cause: the boolean column was renamed to `tse_has_ees_id` during the
-- platform rename, but this layout widget's field entry (and its label) were never
-- updated. Point the entry at the real column and correct the label. The other four
-- checklist fields already resolve to live columns.

WITH tgt AS (
  SELECT w.id, w.widget_config
  FROM public.page_layout_widgets w
  JOIN public.page_layouts pl ON pl.id = w.page_layout_id
  WHERE pl.is_deleted IS NOT TRUE
    AND w.is_deleted IS NOT TRUE
    AND w.widget_type = 'field_group'
    AND pl.page_layout_object = 'time_sheet_entries'
    AND w.widget_config ? 'fields'
    AND w.widget_config @> '{"fields":[{"name":"tse_has_anura_id"}]}'::jsonb
),
rebuilt AS (
  SELECT t.id,
    jsonb_set(t.widget_config, '{fields}', (
      SELECT jsonb_agg(
        CASE
          WHEN e.elem->>'name' = 'tse_has_anura_id'
          THEN jsonb_build_object(
            'name',  'tse_has_ees_id',
            'type',  COALESCE(NULLIF(e.elem->>'type',''), 'boolean'),
            'label', 'Has EES ID'
          )
          ELSE e.elem
        END
        ORDER BY e.ord
      )
      FROM jsonb_array_elements(t.widget_config->'fields') WITH ORDINALITY AS e(elem, ord)
    )) AS new_config
  FROM tgt t
)
UPDATE public.page_layout_widgets w
SET widget_config = r.new_config, updated_at = now()
FROM rebuilt r
WHERE r.id = w.id
  AND r.new_config IS DISTINCT FROM w.widget_config;

NOTIFY pgrst, 'reload schema';
