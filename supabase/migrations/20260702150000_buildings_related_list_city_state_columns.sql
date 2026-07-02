-- Buildings related lists (on all five property page layouts) showed only
-- Record # / Name / Status / Created. Buildings must show their state
-- everywhere they appear, so slot City and State columns in directly after
-- the Name column on every buildings related_list widget that doesn't
-- already carry them. Config-only change; fetchRelatedRecords selects
-- whatever columns the widget_config lists, so no code change is needed.

UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
      w.widget_config,
      '{columns}',
      (
        SELECT COALESCE(jsonb_agg(elem ORDER BY ord), w.widget_config->'columns')
        FROM (
          SELECT t.elem, t.idx * 10 AS ord
          FROM jsonb_array_elements(w.widget_config->'columns') WITH ORDINALITY AS t(elem, idx)
          UNION ALL
          SELECT jsonb_build_object('name','building_city','type','text','label','City'),
                 (SELECT t2.idx * 10 + 1
                  FROM jsonb_array_elements(w.widget_config->'columns') WITH ORDINALITY AS t2(elem, idx)
                  WHERE t2.elem->>'name' = 'building_name' LIMIT 1)
          UNION ALL
          SELECT jsonb_build_object('name','building_state','type','text','label','State'),
                 (SELECT t2.idx * 10 + 2
                  FROM jsonb_array_elements(w.widget_config->'columns') WITH ORDINALITY AS t2(elem, idx)
                  WHERE t2.elem->>'name' = 'building_name' LIMIT 1)
        ) merged
        WHERE ord IS NOT NULL
      )
    ),
    updated_at = now()
WHERE w.widget_type = 'related_list'
  AND w.widget_config->>'table' = 'buildings'
  AND COALESCE(w.is_deleted, false) = false
  AND NOT (w.widget_config->'columns') @> '[{"name":"building_state"}]'::jsonb
  AND (w.widget_config->'columns') @> '[{"name":"building_name"}]'::jsonb;
