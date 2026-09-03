-- The opportunity shows the equipment it installs.
--
-- Three placements, all of them views onto the one new fact
-- (opportunity_line_items.oli_equipment_product_id):
--
--   1. The Equipment Installed field on the line item's own page, right under
--      Product, because it is a follow-up question to it — the picker is scoped
--      by the product chosen above via the qualifying_equipment_for_measure
--      dependent lookup.
--
--   2. An Equipment column on every opportunity's Line Items related list, so a
--      HEAR line with nothing in it is visible as a gap. That is the only place
--      the seven pre-existing line items (5 ventilation, 2 heat pump, created
--      before this column existed) announce themselves.
--
--   3. The Equipment SECTION Nicholas asked for — "a separate section-related
--      list that we can pull in, just like we do the line-item products when
--      you have equipment" — on the HEAR opportunity layouts only.
--
-- The section is a SECOND RELATED LIST OVER THE SAME LINE ITEMS, filtered by
-- oli_is_equipment_line, not a second object. The equipment is an attribute of
-- the line (what this line installs), so a parallel equipment table would store
-- the same fact twice with nothing keeping the two in step: two rows of
-- "ENERGY STAR Ventilation x 8" and one Panasonic, and no way to know which
-- line the fan belongs to. One fact, two views of it.
--
-- HEAR only, deliberately. HEAR is the equipment programme. A HOMES opportunity
-- sells modelled savings — insulation, air sealing — and an Equipment card that
-- can only ever be empty on it is a question with no answer. WI-IRA-MF-HEAR is
-- the only HEAR opportunity layout that exists today; NC and MI get the section
-- the day they get a layout, from this same rule.
--
-- show_in_create on the field is load-bearing. The equipment is CONDITIONALLY
-- required — mandatory when the line's product installs a model-numbered device,
-- refused when it does not — so it can be neither marked required (that would
-- block every wiring or insulation line, which must leave it empty) nor left
-- out of the create pop-up, which shows required fields only and would
-- therefore hide the one field the save is about to demand.


BEGIN;

-- ── 1. The Equipment field on the line item's own page ───────────────────
UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(
         w.widget_config, '{fields}',
         (w.widget_config->'fields') || jsonb_build_object(
           'name',   'oli_equipment_product_id',
           'type',   'lookup',
           'label',  'Equipment Installed',
           'column', 2,
           'lookup_field', 'product_name',
           'lookup_table', 'products',
           'show_in_create', true,
           'lookup_dependency', jsonb_build_object(
             'kind', 'qualifying_equipment_for_measure',
             'depends_on', jsonb_build_array('product_id')
           )
         )
       ),
       updated_at = now()
  FROM public.page_layout_sections s
  JOIN public.page_layouts pl ON pl.id = s.page_layout_id
 WHERE w.section_id = s.id
   AND pl.page_layout_object = 'opportunity_line_items'
   AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE AND w.is_deleted IS NOT TRUE
   AND w.widget_type = 'field_group'
   AND s.section_label = 'Record'
   AND NOT (w.widget_config->'fields') @> '[{"name":"oli_equipment_product_id"}]'::jsonb;

-- ── 2. Equipment on every opportunity's Line Items related list ──────────
UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(
         w.widget_config, '{columns}',
         (w.widget_config->'columns') || jsonb_build_object(
           'name',  'oli_equipment_product_id',
           'type',  'lookup',
           'label', 'Equipment',
           'fk_column',    'oli_equipment_product_id',
           'lookup_field', 'product_name',
           'lookup_table', 'products'
         )
       ),
       updated_at = now()
  FROM public.page_layout_sections s
  JOIN public.page_layouts pl ON pl.id = s.page_layout_id
 WHERE w.section_id = s.id
   AND pl.page_layout_object = 'opportunities'
   AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE AND w.is_deleted IS NOT TRUE
   AND w.widget_type = 'related_list'
   AND w.widget_config->>'table' = 'opportunity_line_items'
   AND NOT (w.widget_config->'columns') @> '[{"name":"oli_equipment_product_id"}]'::jsonb;

-- ── 3. The Equipment section, HEAR opportunity layouts only ──────────────
INSERT INTO public.page_layout_sections (
  page_layout_id, section_order, section_label, section_columns,
  section_is_collapsible, section_is_collapsed_by_default, section_tab
)
SELECT pl.id,
       COALESCE((SELECT s2.section_order FROM public.page_layout_sections s2
                  WHERE s2.page_layout_id = pl.id AND s2.is_deleted IS NOT TRUE
                    AND s2.section_label = 'Opportunity Line Items'), 3) + 1,
       'Equipment', 1, true, false, 'Details'
  FROM public.page_layouts pl
  JOIN public.picklist_values rt ON rt.id = pl.record_type_id
 WHERE pl.page_layout_object = 'opportunities'
   AND pl.is_deleted IS NOT TRUE
   AND rt.picklist_value LIKE '%-HEAR'
   AND NOT EXISTS (
     SELECT 1 FROM public.page_layout_sections s3
      WHERE s3.page_layout_id = pl.id AND s3.is_deleted IS NOT TRUE
        AND s3.section_label = 'Equipment'
   );

INSERT INTO public.page_layout_widgets (
  page_layout_widget_record_number, page_layout_id, section_id,
  widget_type, widget_title, widget_column, widget_position, widget_config
)
SELECT '', s.page_layout_id, s.id, 'related_list', 'Equipment', 1, 1,
  jsonb_build_object(
    'table', 'opportunity_line_items',
    'fk',    'opportunity_id',
    'title', 'Equipment',
    -- The constant-equality filter the related-list widget already supports
    -- (config.match). oli_is_equipment_line is derived on write from the line
    -- product's own product_requires_equipment_selection, so this shows exactly
    -- the lines that install a model-numbered device — no bespoke query, and
    -- nothing for an admin to keep in step by hand.
    'match', jsonb_build_object('oli_is_equipment_line', true),
    'is_deleted_col', 'oli_is_deleted',
    'sort_field', 'oli_record_number',
    'sort_dir', 'asc',
    'columns', jsonb_build_array(
      jsonb_build_object('name','oli_record_number','type','text','label','Line #'),
      jsonb_build_object('name','product_id','type','lookup','label','Measure',
        'fk_column','product_id','lookup_field','product_name','lookup_table','products'),
      jsonb_build_object('name','oli_equipment_product_id','type','lookup','label','Equipment Installed',
        'fk_column','oli_equipment_product_id','lookup_field','product_name','lookup_table','products'),
      jsonb_build_object('name','oli_quantity','type','number','label','Qty'),
      jsonb_build_object('name','unit_id','type','lookup','label','Unit',
        'fk_column','unit_id','lookup_field','unit_name','lookup_table','units')
    )
  )
  FROM public.page_layout_sections s
 WHERE s.section_label = 'Equipment'
   AND s.is_deleted IS NOT TRUE
   AND EXISTS (SELECT 1 FROM public.page_layouts pl
                WHERE pl.id = s.page_layout_id AND pl.page_layout_object = 'opportunities')
   AND NOT EXISTS (
     SELECT 1 FROM public.page_layout_widgets w2
      WHERE w2.section_id = s.id AND w2.is_deleted IS NOT TRUE
   );

COMMIT;

-- ── Assertions ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.page_layout_widgets w
    JOIN public.page_layout_sections s ON s.id = w.section_id
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
   WHERE pl.page_layout_object = 'opportunity_line_items'
     AND w.is_deleted IS NOT TRUE
     AND (w.widget_config->'fields') @> '[{"name":"oli_equipment_product_id"}]'::jsonb;
  IF v_n < 1 THEN RAISE EXCEPTION 'The Equipment field did not land on the line item layout'; END IF;

  SELECT count(*) INTO v_n
    FROM public.page_layout_widgets w
    JOIN public.page_layout_sections s ON s.id = w.section_id
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
   WHERE pl.page_layout_object = 'opportunities'
     AND w.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE
     AND s.section_label = 'Equipment'
     AND w.widget_config->'match'->>'oli_is_equipment_line' = 'true';
  IF v_n < 1 THEN RAISE EXCEPTION 'No Equipment section landed on a HEAR opportunity layout'; END IF;

  -- The negative control: HOMES sells modelled savings, not equipment.
  SELECT count(*) INTO v_n
    FROM public.page_layout_sections s
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
    JOIN public.picklist_values rt ON rt.id = pl.record_type_id
   WHERE pl.page_layout_object = 'opportunities' AND s.is_deleted IS NOT TRUE
     AND s.section_label = 'Equipment' AND rt.picklist_value LIKE '%HOMES%';
  IF v_n > 0 THEN RAISE EXCEPTION 'The Equipment section was added to % HOMES layout(s)', v_n; END IF;

  -- validate_page_layout_widget_config is a TRIGGER on page_layout_widgets, so
  -- it already fired on every insert and update above; there is no callable
  -- form to invoke here. Re-fire it deliberately with a no-op touch, so a
  -- config this migration wrote that the validator would reject fails HERE
  -- rather than the next time somebody clones the layout — the 2026-08-23 trap,
  -- where a layout carrying an unvalidatable field could not be re-inserted.
  UPDATE public.page_layout_widgets w
     SET updated_at = w.updated_at
    FROM public.page_layout_sections s
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
   WHERE w.section_id = s.id AND w.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE
     AND (s.section_label = 'Equipment' OR pl.page_layout_object = 'opportunity_line_items');
END $$;
