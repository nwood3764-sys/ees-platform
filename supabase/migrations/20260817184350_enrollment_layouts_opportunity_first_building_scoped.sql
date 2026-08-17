-- Enrollment layouts follow the new tie: Opportunity, then Building, then the
-- derived Property.
--
--   opportunity_id : required, first, plain searchable lookup (it is the anchor,
--                    so it can no longer be scoped BY the property)
--   building_id    : present on every layout, scoped to the opportunity via the
--                    new buildings_for_opportunity dependent lookup
--   property_id    : no longer required — the trigger fills it from the
--                    opportunity, so it is shown but never picked
--
-- jsonb has no array slicing, so each field group is rebuilt by ordinality:
-- ordinary fields keep position ord*10, and the three relationship fields are
-- re-sorted into opportunity/building/property order at the earliest position
-- any of them previously occupied.
WITH src AS (
  SELECT plw.id AS widget_id, t.f, t.ord
    FROM public.page_layouts pl
    JOIN public.page_layout_sections pls ON pls.page_layout_id = pl.id AND pls.is_deleted IS NOT TRUE
    JOIN public.page_layout_widgets plw ON plw.section_id = pls.id AND plw.is_deleted IS NOT TRUE
    CROSS JOIN LATERAL jsonb_array_elements(plw.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
   WHERE pl.page_layout_object = 'enrollments' AND pl.is_deleted IS NOT TRUE
     AND plw.widget_type = 'field_group'
     AND plw.widget_config->'fields' @> '[{"name":"property_id"}]'::jsonb
), anchor AS (
  SELECT widget_id, min(ord) AS at
    FROM src WHERE f->>'name' IN ('opportunity_id','building_id','property_id')
   GROUP BY widget_id
), rebuilt AS (
  SELECT s.widget_id,
         jsonb_agg(elem ORDER BY sort_ord) AS fields
    FROM (
      SELECT s.widget_id, s.f AS elem, s.ord * 10 AS sort_ord
        FROM src s
       WHERE s.f->>'name' NOT IN ('opportunity_id','building_id','property_id')
      UNION ALL
      SELECT a.widget_id,
             jsonb_build_object(
               'name','opportunity_id','type','lookup','label','Opportunity',
               'column',1,'required',true,
               'lookup_field','opportunity_name','lookup_table','opportunities'),
             a.at * 10 - 3
        FROM anchor a
      UNION ALL
      SELECT a.widget_id,
             jsonb_build_object(
               'name','building_id','type','lookup','label','Building',
               'column',2,
               'lookup_field','building_name','lookup_table','buildings',
               'lookup_dependency', jsonb_build_object(
                 'kind','buildings_for_opportunity',
                 'depends_on', jsonb_build_array('opportunity_id'))),
             a.at * 10 - 2
        FROM anchor a
      UNION ALL
      SELECT a.widget_id,
             jsonb_build_object(
               'name','property_id','type','lookup','label','Property',
               'column',1,
               'lookup_field','property_name','lookup_table','properties'),
             a.at * 10 - 1
        FROM anchor a
    ) s
   GROUP BY s.widget_id
)
UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(w.widget_config, '{fields}', r.fields),
       updated_at = now()
  FROM rebuilt r
 WHERE w.id = r.widget_id;

-- Backfill: an enrollment whose property has exactly ONE live opportunity has an
-- unambiguous tie. The trigger fills building_id and property_id from it. Where
-- the property carries two or more opportunities the tie is a real choice, so it
-- is deliberately left for a person.
UPDATE public.enrollments e
   SET opportunity_id = (
        SELECT o.id FROM public.opportunities o
         WHERE o.property_id = e.property_id AND o.opportunity_is_deleted IS NOT TRUE
         LIMIT 1)
 WHERE e.enrollment_is_deleted IS NOT TRUE
   AND e.opportunity_id IS NULL
   AND (SELECT count(*) FROM public.opportunities o
         WHERE o.property_id = e.property_id AND o.opportunity_is_deleted IS NOT TRUE) = 1;

-- Recompose every live enrollment name now that the rule exists.
UPDATE public.enrollments SET enrollment_name = enrollment_name
 WHERE enrollment_is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
