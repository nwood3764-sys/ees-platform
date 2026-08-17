-- The assessment's Project is visible, and its picker respects the parent chain.
--
-- derive_assessment_project() (migration 20260817163750) now fills
-- assessments.project_id, but no assessment page layout carried the column, so
-- the project it resolved was invisible — and a work order created from the
-- assessment inherited a value the user could neither see nor correct.
--
-- Scoping follows Nicholas's standing rule for related lookups (2026-07-26:
-- "no way possible an incentive application can be on an opportunity that's not
-- on this property"). A project on an assessment must be a project on that
-- assessment's opportunity, so the picker is dependent on opportunity_id rather
-- than offering every project in the platform.

-- New dependent-lookup source, mirroring list_opportunities_for_property.
-- SECURITY INVOKER (the default) so RLS still applies to the caller.
CREATE OR REPLACE FUNCTION public.list_projects_for_opportunity(
  p_opportunity_ids uuid[],
  p_include_project_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(id uuid, project_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT p.id, p.project_name
  FROM projects p
  WHERE p.project_is_deleted = false
    AND (
      p.opportunity_id = ANY(p_opportunity_ids)
      OR (p_include_project_id IS NOT NULL AND p.id = p_include_project_id)
    )
  ORDER BY p.project_name ASC, p.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.list_projects_for_opportunity(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_projects_for_opportunity(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_projects_for_opportunity(uuid[], uuid) TO service_role;

-- Add Project immediately after Opportunity in whichever field group already
-- carries opportunity_id, on every assessment layout that doesn't have it.
-- jsonb has no array slicing, so the field list is rebuilt by ordinality:
-- every existing entry keeps position ord*2, the new one lands at ord*2+1 of
-- the opportunity entry, i.e. directly after it.
WITH src AS (
  SELECT plw.id AS widget_id, t.f, t.ord
    FROM public.page_layouts pl
    JOIN public.page_layout_sections pls ON pls.page_layout_id = pl.id AND pls.is_deleted IS NOT TRUE
    JOIN public.page_layout_widgets plw ON plw.section_id = pls.id AND plw.is_deleted IS NOT TRUE
    CROSS JOIN LATERAL jsonb_array_elements(plw.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
   WHERE pl.page_layout_object = 'assessments' AND pl.is_deleted IS NOT TRUE
     AND plw.widget_type = 'field_group'
     AND plw.widget_config->'fields' @> '[{"name":"opportunity_id"}]'::jsonb
     AND NOT (plw.widget_config->'fields' @> '[{"name":"project_id"}]'::jsonb)
), rebuilt AS (
  SELECT widget_id, jsonb_agg(elem ORDER BY sort_ord) AS fields
    FROM (
      SELECT widget_id, f AS elem, ord * 2 AS sort_ord FROM src
      UNION ALL
      SELECT widget_id,
             jsonb_build_object(
               'name', 'project_id',
               'type', 'lookup',
               'label', 'Project',
               'column', 2,
               'lookup_field', 'project_name',
               'lookup_table', 'projects',
               'lookup_dependency', jsonb_build_object(
                 'kind', 'projects_for_opportunity',
                 'depends_on', jsonb_build_array('opportunity_id'))),
             ord * 2 + 1
        FROM src WHERE f->>'name' = 'opportunity_id'
    ) x
   GROUP BY widget_id
)
UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(w.widget_config, '{fields}', r.fields),
       updated_at = now()
  FROM rebuilt r
 WHERE w.id = r.widget_id;

NOTIFY pgrst, 'reload schema';
