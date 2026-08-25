-- The two download permissions need to be tickable, or they are just columns.
--
-- A purpose-named "Portal Access" section, separate from "Property Owner
-- Portal": that section answers "is this record published to the owner portal",
-- this one answers "may these external users take files off the platform" —
-- and the download flags apply to every portal, not just the owner one.
DO $seed$
DECLARE
  lay        record;
  v_column   text;
  v_label    text;
  v_section  uuid;
  v_widget   uuid;
  v_fields   jsonb;
  v_order    integer;
  v_position integer;
  v_count    integer := 0;
BEGIN
  FOR lay IN
    SELECT pl.id, pl.page_layout_object
    FROM public.page_layouts pl
    WHERE pl.is_deleted = false
      AND pl.page_layout_type = 'record_detail'
      AND pl.page_layout_object IN ('accounts', 'portal_users')
    ORDER BY pl.page_layout_object, pl.page_layout_name
  LOOP
    v_column := CASE lay.page_layout_object
                  WHEN 'accounts'     THEN 'account_allow_portal_download'
                  WHEN 'portal_users' THEN 'portal_user_allow_download'
                END;
    v_label  := CASE lay.page_layout_object
                  WHEN 'accounts'     THEN 'Allow Portal Downloads (Organization)'
                  WHEN 'portal_users' THEN 'Allow Downloads (This User)'
                END;

    UPDATE public.page_layout_widgets w
       SET widget_config = jsonb_set(
             w.widget_config, '{fields}',
             (SELECT COALESCE(jsonb_agg(e.f ORDER BY e.ord), '[]'::jsonb)
                FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS e(f, ord)
               WHERE COALESCE(e.f->>'name', '') <> v_column))
      FROM public.page_layout_sections s
     WHERE w.section_id = s.id
       AND s.page_layout_id = lay.id
       AND s.is_deleted = false
       AND w.is_deleted = false
       AND w.widget_type = 'field_group'
       AND w.widget_config ? 'fields'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') AS x
                    WHERE x->>'name' = v_column);

    SELECT s.id INTO v_section
    FROM public.page_layout_sections s
    WHERE s.page_layout_id = lay.id AND s.is_deleted = false
      AND s.section_label = 'Portal Access'
    ORDER BY s.section_order LIMIT 1;

    IF v_section IS NULL THEN
      SELECT COALESCE(min(s.section_order), (SELECT COALESCE(max(s2.section_order), 0) + 1
                                               FROM public.page_layout_sections s2
                                              WHERE s2.page_layout_id = lay.id AND s2.is_deleted = false))
        INTO v_order
      FROM public.page_layout_sections s
      WHERE s.page_layout_id = lay.id AND s.is_deleted = false
        AND s.section_label = 'System Information';

      INSERT INTO public.page_layout_sections
        (page_layout_id, section_order, section_label, section_columns, section_tab,
         section_placement, section_is_collapsible, section_is_collapsed_by_default)
      VALUES (lay.id, v_order, 'Portal Access', 1, 'Details', 'main', true, false)
      RETURNING id INTO v_section;
    END IF;

    SELECT w.id, w.widget_config->'fields' INTO v_widget, v_fields
    FROM public.page_layout_widgets w
    WHERE w.section_id = v_section AND w.is_deleted = false AND w.widget_type = 'field_group'
    ORDER BY w.widget_position LIMIT 1;

    IF v_widget IS NULL THEN
      SELECT COALESCE(max(w.widget_position), 0) + 1 INTO v_position
      FROM public.page_layout_widgets w
      WHERE w.section_id = v_section AND w.is_deleted = false;

      INSERT INTO public.page_layout_widgets
        (page_layout_id, section_id, widget_type, widget_title, widget_position, widget_config)
      VALUES (lay.id, v_section, 'field_group', 'Portal Access', COALESCE(v_position, 1),
              jsonb_build_object('fields', '[]'::jsonb))
      RETURNING id, widget_config->'fields' INTO v_widget, v_fields;
    END IF;

    UPDATE public.page_layout_widgets
       SET widget_config = jsonb_set(
             widget_config, '{fields}',
             COALESCE(v_fields, '[]'::jsonb) || jsonb_build_array(
               jsonb_build_object('name', v_column, 'label', v_label, 'type', 'boolean')))
     WHERE id = v_widget;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Portal download permission placed on % layouts', v_count;
END;
$seed$;

NOTIFY pgrst, 'reload schema';
