-- The Documents card on the WI-IRA-MF-HOMES-PR enrollment layout is a gallery,
-- on the Related tab AND in the right sidebar.
--
-- Nicholas, 2026-08-27, from an enrollment record: "for documents, I need to be
-- able to select multiple to download. I don't have that functionality here.
-- This should function exactly like it does on the assessment record type," and
-- "I wanna put documents on the right sidebar and on the related tabs… I should
-- be able to put them in both places."
--
-- Root cause: this one layout's "Documents" card is a RELATED LIST on the
-- documents table — a read-only four-column table with no upload, no
-- multi-select and no bulk download. Every other enrollment layout (and the
-- assessment layouts) carries a `file_gallery`, which is where all of that
-- lives. It was the only documents related list in the platform.
--
-- So: soft-delete the related list and put a catch-all documents gallery in its
-- place, plus a second one in the layout's right-rail section — the same card
-- in two places, which is exactly what the editor's new "Copy to…" does. The
-- five typed document SLOTS in Supporting Documentation are untouched; they
-- keep their own program wording and their own uploads.
--
-- Note on what the catch-all shows: a gallery that claims no type lists every
-- file no SLOT on the same SCREEN claims. The slots live on the Details tab, so
-- the Related-tab gallery lists everything on the record, including the files
-- that were uploaded into those slots — which is the "download these and upload
-- more documents outside of this" Nicholas asked for. (That scoping is the
-- client-side half of this change; before it, the exclusion was layout-wide and
-- the two were mutually exclusive.)

DO $$
DECLARE
  v_layout_id      uuid;
  v_related_widget uuid;
  v_related_sec    uuid;
  v_related_pos    integer;
  v_rail_sec       uuid;
  v_rail_pos       integer;
BEGIN
  SELECT id INTO v_layout_id
    FROM public.page_layouts
   WHERE page_layout_object = 'enrollments'
     AND page_layout_name = 'WI-IRA-MF-HOMES-PR — Enrollments'
     AND is_deleted IS NOT TRUE;

  IF v_layout_id IS NULL THEN
    RAISE EXCEPTION 'WI-IRA-MF-HOMES-PR — Enrollments layout not found';
  END IF;

  -- The Related-tab related list on documents, and where it sits.
  SELECT w.id, w.section_id, w.widget_position
    INTO v_related_widget, v_related_sec, v_related_pos
    FROM public.page_layout_widgets w
   WHERE w.page_layout_id = v_layout_id
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'documents';

  IF v_related_widget IS NULL THEN
    RAISE EXCEPTION 'the documents related list this migration replaces is not on the layout';
  END IF;

  UPDATE public.page_layout_widgets
     SET is_deleted = true
   WHERE id = v_related_widget;

  -- The gallery takes its place, in its position, under the same heading.
  INSERT INTO public.page_layout_widgets
    (page_layout_widget_record_number, page_layout_id, section_id, widget_type,
     widget_title, widget_column, widget_position, widget_size, widget_config)
  VALUES
    ('', v_layout_id, v_related_sec, 'file_gallery',
     'Documents', 1, v_related_pos, 'medium',
     '{"target": "documents", "document_type": "attachment"}'::jsonb);

  -- And a second copy in the right-rail section, which is visible on every tab.
  SELECT s.id INTO v_rail_sec
    FROM public.page_layout_sections s
   WHERE s.page_layout_id = v_layout_id
     AND s.is_deleted IS NOT TRUE
     AND coalesce(s.section_placement, 'main') = 'right'
   ORDER BY s.section_order
   LIMIT 1;

  IF v_rail_sec IS NOT NULL THEN
    SELECT coalesce(max(w.widget_position), 0) + 1 INTO v_rail_pos
      FROM public.page_layout_widgets w
     WHERE w.section_id = v_rail_sec
       AND w.is_deleted IS NOT TRUE;

    INSERT INTO public.page_layout_widgets
      (page_layout_widget_record_number, page_layout_id, section_id, widget_type,
       widget_title, widget_column, widget_position, widget_size, widget_config)
    VALUES
      ('', v_layout_id, v_rail_sec, 'file_gallery',
       'Documents', 1, v_rail_pos, 'medium',
       '{"target": "documents", "document_type": "attachment"}'::jsonb);
  END IF;
END $$;

-- The layout must end with two documents galleries and no documents related
-- list anywhere in the platform.
DO $$
DECLARE
  v_galleries integer;
  v_lists     integer;
BEGIN
  SELECT count(*) INTO v_galleries
    FROM public.page_layout_widgets w
    JOIN public.page_layouts pl ON pl.id = w.page_layout_id
   WHERE pl.page_layout_object = 'enrollments'
     AND pl.page_layout_name = 'WI-IRA-MF-HOMES-PR — Enrollments'
     AND pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'file_gallery'
     AND coalesce(w.widget_config->>'document_type', 'attachment') = 'attachment';

  SELECT count(*) INTO v_lists
    FROM public.page_layout_widgets w
    JOIN public.page_layouts pl ON pl.id = w.page_layout_id
   WHERE pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'documents';

  IF v_galleries <> 2 THEN
    RAISE EXCEPTION 'expected 2 catch-all documents galleries on the layout, found %', v_galleries;
  END IF;
  IF v_lists <> 0 THEN
    RAISE EXCEPTION 'a documents related list is still placed somewhere (%)', v_lists;
  END IF;
END $$;
