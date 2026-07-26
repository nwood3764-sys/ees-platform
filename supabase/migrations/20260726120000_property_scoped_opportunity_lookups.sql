-- Property-scoped opportunity lookups
--
-- Rule (Nicholas, 2026-07-26): a child record that carries both a property FK
-- and an opportunity FK must only ever offer opportunities that belong to that
-- same property — never a universal opportunity list. "You really need to make
-- sure you keep the parent relationship intact."
--
-- 1. New dependent-lookup RPC list_opportunities_for_property, mirroring
--    list_buildings_for_property: SECURITY INVOKER (RLS applies to the
--    caller), includes the field's current value so a saved selection that
--    no longer matches the filter still renders instead of appearing blank.
-- 2. Page-layout config: every field_group `opportunity_id` lookup on an
--    object that carries property_id (enrollments, projects, work_orders)
--    gains lookup_dependency {kind: opportunities_for_property,
--    depends_on: [property_id]}. Only layouts that expose a property_id
--    field themselves (or, for enrollments, always — property is required
--    on the object) are touched, so no form ends up with an opportunity
--    picker it can never unlock. incentive_applications layouts carry no
--    opportunity lookup today; when one is added it must use this same
--    dependency.

CREATE OR REPLACE FUNCTION public.list_opportunities_for_property(
  p_property_ids uuid[],
  p_include_opportunity_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, opportunity_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT o.id, o.opportunity_name
  FROM opportunities o
  WHERE o.opportunity_is_deleted = false
    AND (
      o.property_id = ANY(p_property_ids)
      OR (p_include_opportunity_id IS NOT NULL AND o.id = p_include_opportunity_id)
    )
  ORDER BY o.opportunity_name ASC, o.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.list_opportunities_for_property(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_opportunities_for_property(uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_opportunities_for_property(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_opportunities_for_property(uuid[], uuid) TO service_role;

-- 2. Add the dependency to every opportunity_id lookup field on layouts of
-- objects that carry property_id. Enrollments layouts always qualify
-- (property_id is a required field on every enrollment layout); projects and
-- work_orders layouts qualify only when the layout itself exposes a
-- property_id field the user can fill.
WITH qualifying_layouts AS (
  SELECT pl.id
  FROM page_layouts pl
  WHERE pl.is_deleted IS NOT TRUE
    AND (
      pl.page_layout_object = 'enrollments'
      OR (
        pl.page_layout_object IN ('projects', 'work_orders')
        AND EXISTS (
          SELECT 1
          FROM page_layout_sections pls2
          JOIN page_layout_widgets plw2 ON plw2.section_id = pls2.id
            AND plw2.is_deleted IS NOT TRUE
            AND plw2.widget_type = 'field_group'
          CROSS JOIN LATERAL jsonb_array_elements(plw2.widget_config->'fields') f2
          WHERE pls2.page_layout_id = pl.id
            AND pls2.is_deleted IS NOT TRUE
            AND f2->>'name' = 'property_id'
        )
      )
    )
),
target_widgets AS (
  SELECT plw.id
  FROM page_layout_widgets plw
  JOIN page_layout_sections pls ON pls.id = plw.section_id AND pls.is_deleted IS NOT TRUE
  JOIN qualifying_layouts ql ON ql.id = pls.page_layout_id
  WHERE plw.is_deleted IS NOT TRUE
    AND plw.widget_type = 'field_group'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(plw.widget_config->'fields') f
      WHERE f->>'name' = 'opportunity_id'
        AND f->>'type' = 'lookup'
        AND f->>'lookup_table' = 'opportunities'
        AND f->'lookup_dependency' IS NULL
    )
)
UPDATE page_layout_widgets plw
SET widget_config = jsonb_set(
  plw.widget_config,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN f->>'name' = 'opportunity_id'
         AND f->>'type' = 'lookup'
         AND f->>'lookup_table' = 'opportunities'
         AND f->'lookup_dependency' IS NULL
        THEN f || jsonb_build_object(
          'lookup_dependency',
          jsonb_build_object(
            'kind', 'opportunities_for_property',
            'depends_on', jsonb_build_array('property_id')
          )
        )
        ELSE f
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(plw.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
  )
)
FROM target_widgets tw
WHERE plw.id = tw.id;

NOTIFY pgrst, 'reload schema';
