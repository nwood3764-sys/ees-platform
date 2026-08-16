-- Assessment layouts: bind the relationship fields to the real FK columns.
--
-- Creating an Assessment from an opportunity showed "OPPORTUNITY" as a raw uuid
-- in a text box (Nicholas, 2026-08-16: "the opportunity comes in as a computer
-- code… no one will be able to select the proper opportunity"). Root cause: the
-- assessment layouts bind Opportunity and Building to the legacy import columns
-- assessment_opportunity / assessment_building_del — plain uuid columns with no
-- foreign key and no type on the layout entry — instead of the real FK columns
-- opportunity_id / building_id. With no FK the column metadata can't say what
-- the field points at, so it renders as text.
--
-- The workaround in place until now was seeding BOTH columns at create so the
-- form looked populated. This removes the workaround: the layouts point at the
-- real columns, which are the ones with referential integrity, the ones every
-- related list and report already use, and the ones a scoped picker can drive.
--
-- Live data is consistent — all 12 assessments carry both columns with matching
-- values (0 mismatches, 0 legacy-only rows) — so nothing is lost. The legacy
-- columns are left in place (unused); dropping them is a separate decision.
--
-- Three parts:
--   1. Backfill the real FK from the legacy column (no-op on today's data).
--   2. Give assessment_property_contact_for_iq_assessment a real FK to contacts
--      so it types as a contact lookup everywhere instead of a uuid text box.
--   3. Rewrite the layout field entries: legacy column -> real FK column, typed
--      as a lookup and scoped to the assessment's property, and add the Building
--      lookup to the layouts that never carried one (building_id is NOT NULL, so
--      the create form has to ask for it).

-- 1 ─────────────────────────────────────────────────────────────────────────
UPDATE public.assessments
   SET opportunity_id = assessment_opportunity
 WHERE opportunity_id IS NULL
   AND assessment_opportunity IS NOT NULL;

UPDATE public.assessments
   SET building_id = assessment_building_del
 WHERE building_id IS NULL
   AND assessment_building_del IS NOT NULL;

-- 2 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.assessments
  ADD CONSTRAINT assessments_property_contact_for_iq_assessment_fkey
  FOREIGN KEY (assessment_property_contact_for_iq_assessment)
  REFERENCES public.contacts(id);

-- 3 ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  w            record;
  fields       jsonb;
  rebuilt      jsonb;
  elem         jsonb;
  name         text;
  has_building boolean;
BEGIN
  FOR w IN
    SELECT plw.id, plw.widget_config, pls.page_layout_id
      FROM public.page_layout_widgets plw
      JOIN public.page_layout_sections pls ON pls.id = plw.section_id
      JOIN public.page_layouts pl          ON pl.id  = pls.page_layout_id
     WHERE pl.page_layout_object = 'assessments'
       AND plw.widget_type = 'field_group'
       AND plw.is_deleted = false
       AND pls.is_deleted = false
       AND pl.is_deleted  = false
       AND jsonb_typeof(plw.widget_config -> 'fields') = 'array'
  LOOP
    fields  := w.widget_config -> 'fields';
    rebuilt := '[]'::jsonb;

    -- Does this layout already carry a Building field anywhere?
    SELECT EXISTS (
      SELECT 1
        FROM public.page_layout_widgets x
        JOIN public.page_layout_sections xs ON xs.id = x.section_id
       WHERE xs.page_layout_id = w.page_layout_id
         AND x.is_deleted = false AND xs.is_deleted = false
         AND x.widget_config -> 'fields' @> '[{"name":"building_id"}]'::jsonb
    ) INTO has_building;

    FOR elem IN SELECT value FROM jsonb_array_elements(fields) LOOP
      name := elem ->> 'name';

      IF name = 'assessment_opportunity' THEN
        rebuilt := rebuilt || jsonb_build_array(
          (elem - 'name') || jsonb_build_object(
            'name',         'opportunity_id',
            'type',         'lookup',
            'label',        'Opportunity',
            'lookup_table', 'opportunities',
            'lookup_field', 'opportunity_name',
            'lookup_dependency', jsonb_build_object(
              'kind',       'opportunities_for_property',
              'depends_on', jsonb_build_array('property_id'))));

      ELSIF name = 'assessment_building_del' THEN
        rebuilt := rebuilt || jsonb_build_array(
          (elem - 'name') || jsonb_build_object(
            'name',         'building_id',
            'type',         'lookup',
            'label',        'Building',
            'lookup_table', 'buildings',
            'lookup_field', 'building_name',
            'lookup_dependency', jsonb_build_object(
              'kind',       'buildings_for_property',
              'depends_on', jsonb_build_array('property_id'))));
        has_building := true;

      ELSIF name = 'assessment_property_contact_for_iq_assessment' THEN
        rebuilt := rebuilt || jsonb_build_array(
          elem || jsonb_build_object(
            'type',         'lookup',
            'label',        'Property Contact for IQ Assessment',
            'lookup_table', 'contacts',
            'lookup_field', 'contact_name'));

      ELSIF name = 'property_id' THEN
        rebuilt := rebuilt || jsonb_build_array(elem);
        -- building_id is NOT NULL: a layout that never carried it left the
        -- create form asking for an unlabeled required column. Place it right
        -- after the Property it belongs to, scoped to that property.
        IF NOT has_building THEN
          rebuilt := rebuilt || jsonb_build_array(jsonb_build_object(
            'name',         'building_id',
            'type',         'lookup',
            'label',        'Building',
            'required',     true,
            'lookup_table', 'buildings',
            'lookup_field', 'building_name',
            'lookup_dependency', jsonb_build_object(
              'kind',       'buildings_for_property',
              'depends_on', jsonb_build_array('property_id'))));
          has_building := true;
        END IF;

      ELSE
        rebuilt := rebuilt || jsonb_build_array(elem);
      END IF;
    END LOOP;

    IF rebuilt IS DISTINCT FROM fields THEN
      UPDATE public.page_layout_widgets
         SET widget_config = jsonb_set(widget_config, '{fields}', rebuilt)
       WHERE id = w.id;
    END IF;
  END LOOP;
END $$;

-- A layout that carried assessment_building_del AND property_id gets the
-- Building field twice above (once inserted after Property, once converted from
-- the legacy column). Keep the first occurrence of each named field per layout;
-- unnamed entries (spacers) are untouched.
DO $$
DECLARE
  lay      record;
  w        record;
  fields   jsonb;
  rebuilt  jsonb;
  elem     jsonb;
  name     text;
  seen     text[];
BEGIN
  FOR lay IN
    SELECT id FROM public.page_layouts
     WHERE page_layout_object = 'assessments' AND is_deleted = false
  LOOP
    seen := ARRAY[]::text[];
    FOR w IN
      SELECT plw.id, plw.widget_config
        FROM public.page_layout_widgets plw
        JOIN public.page_layout_sections pls ON pls.id = plw.section_id
       WHERE pls.page_layout_id = lay.id
         AND plw.widget_type = 'field_group'
         AND plw.is_deleted = false AND pls.is_deleted = false
         AND jsonb_typeof(plw.widget_config -> 'fields') = 'array'
       ORDER BY pls.section_order, plw.widget_position
    LOOP
      fields  := w.widget_config -> 'fields';
      rebuilt := '[]'::jsonb;
      FOR elem IN SELECT value FROM jsonb_array_elements(fields) LOOP
        name := elem ->> 'name';
        IF name IS NULL THEN
          rebuilt := rebuilt || jsonb_build_array(elem);
        ELSIF name = ANY (seen) THEN
          CONTINUE;
        ELSE
          seen    := seen || name;
          rebuilt := rebuilt || jsonb_build_array(elem);
        END IF;
      END LOOP;
      IF rebuilt IS DISTINCT FROM fields THEN
        UPDATE public.page_layout_widgets
           SET widget_config = jsonb_set(widget_config, '{fields}', rebuilt)
         WHERE id = w.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;
