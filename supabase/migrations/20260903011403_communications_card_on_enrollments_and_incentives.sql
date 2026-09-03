-- =============================================================================
-- The Communications card, on every enrollment and every incentive layout.
--
-- Nicholas, 2026-09-03: "we need to have a communication on all enrollment
-- objects and all incentive record objects."
--
-- Before this: 21 of 24 incentive layouts carried it, three did not, and no
-- enrollment layout could — `conversations` had no enrollment anchor until the
-- migration before this one.
--
-- The card is also given ONE name. It was seeded as "Conversations" on 47
-- layouts while the palette that places it has called it "Communications"
-- since it shipped, so the same card answered to two names depending on which
-- screen you were on. Nicholas calls it communication; the palette agrees;
-- the seeded rows are brought into line rather than a third name invented.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. One name for one card.
-- -----------------------------------------------------------------------------
UPDATE public.page_layout_widgets
   SET widget_title = 'Communications'
 WHERE widget_type = 'conversation_panel'
   AND widget_title = 'Conversations'
   AND coalesce(is_deleted, false) = false;

UPDATE public.page_layout_sections s
   SET section_label = 'Communications'
 WHERE s.section_label = 'Conversations'
   AND coalesce(s.is_deleted, false) = false
   AND EXISTS (
     SELECT 1 FROM public.page_layout_widgets w
     WHERE w.section_id = s.id
       AND w.widget_type = 'conversation_panel'
       AND coalesce(w.is_deleted, false) = false
   );

-- -----------------------------------------------------------------------------
-- 2. Place it where it is missing.
--
-- The anchor column is read from conversation_anchor_columns(), the same
-- registry the feed and the import use — the widget's config can therefore
-- never name a column the thread cannot be stored in.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE
  r          record;
  v_section  uuid;
  v_fk       text;
  v_order    int;
  v_added    int := 0;
BEGIN
  FOR r IN
    SELECT pl.id, pl.page_layout_object AS obj, pl.page_layout_name AS nm
    FROM public.page_layouts pl
    WHERE pl.page_layout_object IN ('enrollments', 'incentive_applications')
      AND pl.page_layout_type = 'record_detail'
      AND coalesce(pl.is_deleted, false) = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.page_layout_sections s
        JOIN public.page_layout_widgets w
          ON w.section_id = s.id AND coalesce(w.is_deleted, false) = false
        WHERE s.page_layout_id = pl.id
          AND coalesce(s.is_deleted, false) = false
          AND w.widget_type = 'conversation_panel'
      )
    ORDER BY pl.page_layout_object, pl.page_layout_name
  LOOP
    SELECT a.fk_column INTO v_fk
    FROM public.conversation_anchor_columns() a
    WHERE a.object_name = r.obj;
    IF v_fk IS NULL THEN
      RAISE EXCEPTION '% has no conversations anchor, so the card would hold nothing', r.obj;
    END IF;

    SELECT coalesce(max(s.section_order), 200) + 1 INTO v_order
    FROM public.page_layout_sections s
    WHERE s.page_layout_id = r.id AND coalesce(s.is_deleted, false) = false;

    INSERT INTO public.page_layout_sections (
      page_layout_id, section_order, section_label, section_columns,
      section_is_collapsible, section_is_collapsed_by_default,
      section_tab, section_placement
    ) VALUES (
      r.id, v_order, 'Communications', 1,
      true, true,
      'Related', 'main'
    )
    RETURNING id INTO v_section;

    INSERT INTO public.page_layout_widgets (
      page_layout_widget_record_number, page_layout_id, section_id,
      widget_type, widget_title, widget_column, widget_position, widget_size,
      widget_config
    ) VALUES (
      '', r.id, v_section,
      'conversation_panel', 'Communications', 1, 1, 'large',
      jsonb_build_object('fk', v_fk, 'table', 'conversations', 'channel_filter', NULL)
    );

    v_added := v_added + 1;
  END LOOP;

  RAISE NOTICE 'Communications card added to % layout(s)', v_added;
END
$do$;

-- -----------------------------------------------------------------------------
-- 3. Prove the coverage, and that nobody got two.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE
  v_missing int;
  v_double  int;
  v_named   int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.page_layouts pl
  WHERE pl.page_layout_object IN ('enrollments', 'incentive_applications')
    AND pl.page_layout_type = 'record_detail'
    AND coalesce(pl.is_deleted, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.page_layout_sections s
      JOIN public.page_layout_widgets w
        ON w.section_id = s.id AND coalesce(w.is_deleted, false) = false
      WHERE s.page_layout_id = pl.id
        AND coalesce(s.is_deleted, false) = false
        AND w.widget_type = 'conversation_panel'
    );
  IF v_missing <> 0 THEN
    RAISE EXCEPTION '% enrollment/incentive layout(s) still have no Communications card', v_missing;
  END IF;

  SELECT count(*) INTO v_double FROM (
    SELECT pl.id
    FROM public.page_layouts pl
    JOIN public.page_layout_sections s
      ON s.page_layout_id = pl.id AND coalesce(s.is_deleted, false) = false
    JOIN public.page_layout_widgets w
      ON w.section_id = s.id AND coalesce(w.is_deleted, false) = false
    WHERE w.widget_type = 'conversation_panel'
      AND coalesce(pl.is_deleted, false) = false
    GROUP BY pl.id
    HAVING count(*) > 1
  ) d;
  IF v_double <> 0 THEN
    RAISE EXCEPTION '% layout(s) carry more than one Communications card', v_double;
  END IF;

  SELECT count(*) INTO v_named
  FROM public.page_layout_widgets
  WHERE widget_type = 'conversation_panel'
    AND coalesce(is_deleted, false) = false
    AND widget_title <> 'Communications';
  IF v_named <> 0 THEN
    RAISE EXCEPTION '% Communications card(s) still carry another name', v_named;
  END IF;

  -- Every placed card names a column a thread can actually be stored in.
  IF EXISTS (
    SELECT 1
    FROM public.page_layouts pl
    JOIN public.page_layout_sections s
      ON s.page_layout_id = pl.id AND coalesce(s.is_deleted, false) = false
    JOIN public.page_layout_widgets w
      ON w.section_id = s.id AND coalesce(w.is_deleted, false) = false
    WHERE w.widget_type = 'conversation_panel'
      AND coalesce(pl.is_deleted, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM public.conversation_anchor_columns() a
        WHERE a.object_name = pl.page_layout_object
          AND a.fk_column   = w.widget_config ->> 'fk'
      )
  ) THEN
    RAISE EXCEPTION 'a Communications card names an anchor column its object does not have';
  END IF;
END
$do$;
