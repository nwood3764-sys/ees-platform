-- Relabel the contact_user_id lookup from the misleading "Salesforce User" /
-- "Auth User" to "Linked User Account" across all contact page layouts. The
-- field links a contact to its internal users-table login account; it is not a
-- Salesforce integration. Rewrites only the matching field entry's label.
WITH targets AS (
  SELECT w.id AS widget_id,
         jsonb_agg(
           CASE WHEN f->>'name' = 'contact_user_id'
                THEN jsonb_set(f, '{label}', '"Linked User Account"'::jsonb)
                ELSE f END
           ORDER BY ord
         ) AS new_fields
  FROM page_layout_widgets w
  JOIN page_layouts pl ON pl.id = w.page_layout_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb))
                     WITH ORDINALITY AS arr(f, ord)
  WHERE pl.page_layout_object = 'contacts'
    AND w.widget_config ? 'fields'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') x
                WHERE x->>'name' = 'contact_user_id')
  GROUP BY w.id
)
UPDATE page_layout_widgets w
SET widget_config = jsonb_set(w.widget_config, '{fields}', t.new_fields)
FROM targets t
WHERE w.id = t.widget_id;
