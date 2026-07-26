-- Opportunity line item scoped pickers — layout config only
--
-- This migration is deliberately separate from 20260726220000 because it is
-- the one piece that DEPENDS ON FRONTEND CODE. `lookup_dependency.kind` is
-- resolved by fetchDependentLookupOptions in src/data/layoutService.js; a
-- deployed bundle that predates those three kinds throws on the unknown kind
-- and renders an EMPTY dropdown.
--
-- Hard-won (2026-07-26): 20260726220000 set these keys on production while
-- the matching bundle was still unmerged, which killed the Product and Price
-- Book Entry pickers on the live line-item form. The keys were stripped to
-- restore service and moved here.
--
-- APPLY THIS ONLY AFTER the bundle carrying the three kinds is live on
-- master/prod (verify via the Netlify API: current deploy commit_ref +
-- state, per the CLAUDE.md note that direct fetches of the site are proxied).

UPDATE page_layout_widgets plw
SET widget_config = jsonb_set(
  plw.widget_config,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE f->>'name'
        WHEN 'product_id' THEN f || jsonb_build_object(
          'lookup_dependency', jsonb_build_object(
            'kind', 'products_for_opportunity',
            'depends_on', jsonb_build_array('opportunity_id')))
        WHEN 'price_book_entry_id' THEN f || jsonb_build_object(
          'lookup_dependency', jsonb_build_object(
            'kind', 'price_book_entries_for_opportunity',
            'depends_on', jsonb_build_array('opportunity_id', 'product_id'),
            'create_seed', jsonb_build_object('product_id', 'product_id')))
        WHEN 'unit_id' THEN f || jsonb_build_object(
          'lookup_dependency', jsonb_build_object(
            'kind', 'units_for_opportunity',
            'depends_on', jsonb_build_array('opportunity_id')))
        ELSE f
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(plw.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
  )
)
FROM page_layout_sections pls, page_layouts pl
WHERE plw.section_id = pls.id
  AND pls.page_layout_id = pl.id
  AND pl.page_layout_object = 'opportunity_line_items'
  AND pl.is_deleted IS NOT TRUE
  AND pls.is_deleted IS NOT TRUE
  AND plw.is_deleted IS NOT TRUE
  AND plw.widget_type = 'field_group'
  AND plw.widget_config ? 'fields';

NOTIFY pgrst, 'reload schema';
