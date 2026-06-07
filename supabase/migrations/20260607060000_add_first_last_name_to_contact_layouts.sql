-- Contact create/detail layouts showed the derived (read-only) contact_name but
-- omitted contact_first_name / contact_last_name, leaving no way to enter the
-- names trg_contact_name derives from — blocking contact creation (all three
-- NOT NULL). Splice editable First Name + Last Name in immediately before
-- contact_name in every contacts field_group that has contact_name and lacks them.
WITH rebuilt AS (
  SELECT w.id AS widget_id,
    ( SELECT jsonb_agg(elem ORDER BY ord)
      FROM (
        SELECT
          CASE WHEN f->>'name' = 'contact_name'
            THEN jsonb_build_array(
                   jsonb_build_object('name','contact_first_name','label','First Name','type','text','required',true),
                   jsonb_build_object('name','contact_last_name','label','Last Name','type','text','required',true),
                   f)
            ELSE jsonb_build_array(f)
          END AS chunk, ord
        FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS arr(f, ord)
      ) expanded,
      LATERAL jsonb_array_elements(expanded.chunk) AS elem
    ) AS new_fields
  FROM page_layout_widgets w
  JOIN page_layouts pl ON pl.id = w.page_layout_id
  WHERE pl.page_layout_object='contacts' AND w.widget_type='field_group'
    AND w.widget_config ? 'fields'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') x WHERE x->>'name'='contact_name')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') x WHERE x->>'name'='contact_first_name')
)
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(w.widget_config, '{fields}', r.new_fields)
FROM rebuilt r
WHERE w.id = r.widget_id;
