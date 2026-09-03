-- Approved models are managed on the product record itself.
--
-- product_qualifying_equipment was created with a table, a record number, RLS
-- and a trigger — and no way for a person to see or edit a row. That is the
-- HA-00053 failure: a help article telling somebody to go somewhere the
-- platform does not have. An approved-model list nobody can add to is a
-- database change every time a second fan is approved, which is exactly what
-- putting it in a table instead of in code was meant to avoid.
--
-- Two placements, because the junction reads both ways and each direction
-- answers a different question:
--
--   On an INCENTIVE MEASURE ("ENERGY STAR Ventilation") — "which models may I
--   install to claim this?" This is the one the picker on the line item is
--   scoped by, and the one somebody adds to when a new fan is approved.
--
--   On an EQUIPMENT product ("Panasonic FV-0511VF1") — "what does this fan
--   qualify for?" The same rows, read from the other end. A model can qualify
--   under more than one programme, so this is not a mirror of a one-to-one.
--
-- Both are added to EVERY product layout rather than only the ones that happen
-- to need them today, because a product's record type can be changed and a
-- card that silently isn't there on the layout you switched to reads as "this
-- fan qualifies for nothing".

BEGIN;

-- ── 1. A page layout for the junction itself ─────────────────────────────
--
-- Without one, the related list's New button falls back to deriving fields from
-- describe_object_columns — which works, but offers the raw column names and no
-- ordering. This is a three-question record; it deserves the three questions.
INSERT INTO public.page_layouts (
  page_layout_record_number, page_layout_name, page_layout_object,
  page_layout_type, page_layout_is_default, page_layout_description,
  page_layout_owner, page_layout_created_by
)
SELECT '', 'Standard Qualifying Equipment Layout', 'product_qualifying_equipment',
       'record', true,
       'Links an incentive measure product to a real equipment product approved for it.',
       pl.page_layout_owner, pl.page_layout_created_by
  FROM public.page_layouts pl
 WHERE pl.page_layout_object = 'products' AND pl.is_deleted IS NOT TRUE
 LIMIT 1;

INSERT INTO public.page_layout_sections (
  page_layout_id, section_order, section_label, section_columns,
  section_is_collapsible, section_is_collapsed_by_default, section_tab
)
SELECT pl.id, 1, 'Record', 2, false, false, 'Details'
  FROM public.page_layouts pl
 WHERE pl.page_layout_object = 'product_qualifying_equipment' AND pl.is_deleted IS NOT TRUE
   AND NOT EXISTS (SELECT 1 FROM public.page_layout_sections s
                    WHERE s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE);

INSERT INTO public.page_layout_widgets (
  page_layout_widget_record_number, page_layout_id, section_id,
  widget_type, widget_title, widget_column, widget_position, widget_config
)
SELECT '', s.page_layout_id, s.id, 'field_group', 'Details', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','pqe_record_number','type','text','label','Record #','column',1),
    jsonb_build_object('name','pqe_measure_product_id','type','lookup','label','Incentive Measure',
      'column',1,'lookup_field','product_name','lookup_table','products','required',true),
    jsonb_build_object('name','pqe_equipment_product_id','type','lookup','label','Approved Equipment',
      'column',2,'lookup_field','product_name','lookup_table','products','required',true),
    jsonb_build_object('name','pqe_is_active','type','boolean','label','Active','column',2),
    jsonb_build_object('name','pqe_notes','type','textarea','label','Notes','column',1)
  ))
  FROM public.page_layout_sections s
  JOIN public.page_layouts pl ON pl.id = s.page_layout_id
 WHERE pl.page_layout_object = 'product_qualifying_equipment'
   AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE
   AND NOT EXISTS (SELECT 1 FROM public.page_layout_widgets w
                    WHERE w.section_id = s.id AND w.is_deleted IS NOT TRUE);

COMMIT;

BEGIN;

-- ── 2. The two related lists on every product layout ─────────────────────
INSERT INTO public.page_layout_sections (
  page_layout_id, section_order, section_label, section_columns,
  section_is_collapsible, section_is_collapsed_by_default, section_tab
)
SELECT pl.id,
       COALESCE((SELECT max(s2.section_order) FROM public.page_layout_sections s2
                  WHERE s2.page_layout_id = pl.id AND s2.is_deleted IS NOT TRUE), 0) + 1,
       'Qualifying Equipment', 1, true, false, 'Related'
  FROM public.page_layouts pl
 WHERE pl.page_layout_object = 'products' AND pl.is_deleted IS NOT TRUE
   AND NOT EXISTS (SELECT 1 FROM public.page_layout_sections s3
                    WHERE s3.page_layout_id = pl.id AND s3.is_deleted IS NOT TRUE
                      AND s3.section_label = 'Qualifying Equipment');

-- Direction A: on a MEASURE, the models approved for it.
INSERT INTO public.page_layout_widgets (
  page_layout_widget_record_number, page_layout_id, section_id,
  widget_type, widget_title, widget_column, widget_position, widget_config
)
SELECT '', s.page_layout_id, s.id, 'related_list', 'Approved Equipment Models', 1, 1,
  jsonb_build_object(
    'table', 'product_qualifying_equipment',
    'fk',    'pqe_measure_product_id',
    'title', 'Approved Equipment Models',
    'is_deleted_col', 'pqe_is_deleted',
    'sort_field', 'pqe_record_number', 'sort_dir', 'asc',
    'columns', jsonb_build_array(
      jsonb_build_object('name','pqe_record_number','type','text','label','Record #'),
      jsonb_build_object('name','pqe_equipment_product_id','type','lookup','label','Equipment',
        'fk_column','pqe_equipment_product_id','lookup_field','product_name','lookup_table','products'),
      jsonb_build_object('name','pqe_is_active','type','boolean','label','Active')
    )
  )
  FROM public.page_layout_sections s
  JOIN public.page_layouts pl ON pl.id = s.page_layout_id
 WHERE pl.page_layout_object = 'products' AND s.section_label = 'Qualifying Equipment'
   AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE
   AND NOT EXISTS (SELECT 1 FROM public.page_layout_widgets w
                    WHERE w.section_id = s.id AND w.is_deleted IS NOT TRUE
                      AND w.widget_config->>'fk' = 'pqe_measure_product_id');

-- Direction B: on an EQUIPMENT product, the measures it qualifies for.
INSERT INTO public.page_layout_widgets (
  page_layout_widget_record_number, page_layout_id, section_id,
  widget_type, widget_title, widget_column, widget_position, widget_config
)
SELECT '', s.page_layout_id, s.id, 'related_list', 'Qualifies For These Measures', 1, 2,
  jsonb_build_object(
    'table', 'product_qualifying_equipment',
    'fk',    'pqe_equipment_product_id',
    'title', 'Qualifies For These Measures',
    'is_deleted_col', 'pqe_is_deleted',
    'sort_field', 'pqe_record_number', 'sort_dir', 'asc',
    'columns', jsonb_build_array(
      jsonb_build_object('name','pqe_record_number','type','text','label','Record #'),
      jsonb_build_object('name','pqe_measure_product_id','type','lookup','label','Incentive Measure',
        'fk_column','pqe_measure_product_id','lookup_field','product_name','lookup_table','products'),
      jsonb_build_object('name','pqe_is_active','type','boolean','label','Active')
    )
  )
  FROM public.page_layout_sections s
  JOIN public.page_layouts pl ON pl.id = s.page_layout_id
 WHERE pl.page_layout_object = 'products' AND s.section_label = 'Qualifying Equipment'
   AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE
   AND NOT EXISTS (SELECT 1 FROM public.page_layout_widgets w
                    WHERE w.section_id = s.id AND w.is_deleted IS NOT TRUE
                      AND w.widget_config->>'fk' = 'pqe_equipment_product_id');

COMMIT;

-- ── 3. The measure flag is editable, not a migration ─────────────────────
--
-- Turning the requirement on for a new measure must be a checkbox, or the
-- "nothing is hardcoded" rule just moves the hardcoding from a constant into a
-- migration nobody can run.
BEGIN;
UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(
         w.widget_config, '{fields}',
         (w.widget_config->'fields') || jsonb_build_object(
           'name','product_requires_equipment_selection','type','boolean',
           'label','Requires Equipment Selection','column',2
         )),
       updated_at = now()
  FROM public.page_layout_sections s
  JOIN public.page_layouts pl ON pl.id = s.page_layout_id
 WHERE w.section_id = s.id
   AND pl.page_layout_object = 'products'
   AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE AND w.is_deleted IS NOT TRUE
   AND w.widget_type = 'field_group'
   AND (w.widget_config->'fields') @> '[{"name":"product_model_number"}]'::jsonb
   AND NOT (w.widget_config->'fields') @> '[{"name":"product_requires_equipment_selection"}]'::jsonb;
COMMIT;

-- ── Assertions ───────────────────────────────────────────────────────────
DO $$
DECLARE v_layout int; v_lists int;
BEGIN
  SELECT count(*) INTO v_layout FROM public.page_layouts
   WHERE page_layout_object = 'product_qualifying_equipment' AND is_deleted IS NOT TRUE;
  IF v_layout < 1 THEN
    RAISE EXCEPTION 'product_qualifying_equipment has no page layout, so its rows are still unreachable';
  END IF;

  SELECT count(*) INTO v_lists
    FROM public.page_layout_widgets w
    JOIN public.page_layout_sections s ON s.id = w.section_id
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
   WHERE pl.page_layout_object = 'products' AND w.is_deleted IS NOT TRUE
     AND s.is_deleted IS NOT TRUE
     AND w.widget_config->>'table' = 'product_qualifying_equipment';
  IF v_lists < 2 THEN
    RAISE EXCEPTION 'Expected both directions of the approved-model list on the product layouts; found %', v_lists;
  END IF;
END $$;
