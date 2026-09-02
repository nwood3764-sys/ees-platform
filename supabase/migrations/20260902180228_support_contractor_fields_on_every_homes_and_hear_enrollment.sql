-- The HEAR reservation layout asks "Will a Support Contractor also be completing
-- work on this project?" and then has nowhere to name one: the question sits on
-- Primary Contractor Information and no Support Contractor section exists at
-- all. Answering Yes therefore records a support contractor the page can never
-- show and nobody can enter -- which is exactly what ENR-00071 looked like: the
-- flag reading Yes, then straight on to Installation Building Information.
--
-- The HOMES reservation layout (PL-00377) already carries the section, gated on
-- that same flag. So this is not a new design; it is the same section, put on
-- the two enrollment layouts missing it. Cloned from PL-00377 rather than
-- retyped, so the field list, labels, dependent-contact lookups and the
-- visible_when gate are identical by construction and cannot drift.
--
-- The gate is what makes this safe for HEAR, where there may well be no support
-- contractor (Nicholas, 2026-09-01): the section appears only once someone
-- answers Yes, so a HEAR enrollment without one looks exactly as it does today.

DO $$
DECLARE
  v_user     uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_src_cfg  jsonb;
  v_src      record;
  v_target   record;
  v_section  uuid;
  v_at       int;
  v_added    int := 0;
BEGIN
  SELECT w.widget_config, w.widget_title, w.widget_column, w.widget_position, w.widget_size,
         s.section_columns, s.section_is_collapsible, s.section_is_collapsed_by_default,
         s.section_tab, s.section_placement
    INTO v_src
  FROM public.page_layouts pl
  JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
  JOIN public.page_layout_widgets  w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  WHERE pl.page_layout_record_number = 'PL-00377'
    AND s.section_label = 'Support Contractor Information';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'source Support Contractor Information section not found on PL-00377';
  END IF;
  v_src_cfg := v_src.widget_config;
  IF v_src_cfg -> 'visible_when' ->> 'field' IS DISTINCT FROM 'enrollment_has_support_contractor' THEN
    RAISE EXCEPTION 'source section is not gated on the support-contractor flag; refusing to clone it';
  END IF;

  FOR v_target IN
    SELECT pl.id, pl.page_layout_record_number AS rn
    FROM public.page_layouts pl
    WHERE pl.page_layout_object = 'enrollments' AND pl.is_deleted IS NOT TRUE
      AND pl.page_layout_record_number IN ('PL-00404','PL-00378')
  LOOP
    IF EXISTS (SELECT 1 FROM public.page_layout_sections s
                WHERE s.page_layout_id = v_target.id AND s.is_deleted IS NOT TRUE
                  AND s.section_label = 'Support Contractor Information') THEN
      CONTINUE;
    END IF;

    -- A layout with no flag to gate on gets one first, on its own contractor
    -- section. Without it the cloned section would be permanently invisible.
    IF NOT EXISTS (
      SELECT 1 FROM public.page_layout_sections s
      JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
      WHERE s.page_layout_id = v_target.id AND s.is_deleted IS NOT TRUE
        AND w.widget_config::text LIKE '%enrollment_has_support_contractor%')
    THEN
      UPDATE public.page_layout_widgets w
         SET widget_config = jsonb_set(w.widget_config, '{fields}',
               (w.widget_config -> 'fields') || jsonb_build_array(jsonb_build_object(
                 'name','enrollment_has_support_contractor','type','boolean','column',1,
                 'label','Will a Support Contractor also be completing work on this project? Only IRA-registered contractors may perform work on IRA HOMES projects.'))),
             updated_by = v_user
        FROM public.page_layout_sections s
       WHERE s.id = w.section_id AND s.page_layout_id = v_target.id
         AND s.is_deleted IS NOT TRUE AND w.is_deleted IS NOT TRUE
         AND w.widget_type = 'field_group'
         AND s.section_label ILIKE '%Contractor%';
    END IF;

    SELECT MIN(s2.section_order) INTO v_at
    FROM public.page_layout_sections s2
    WHERE s2.page_layout_id = v_target.id AND s2.is_deleted IS NOT TRUE
      AND s2.section_label ILIKE '%Contractor%';

    -- Slot it directly after the primary contractor section, so the page reads
    -- in the order the programme's own form does.
    UPDATE public.page_layout_sections
       SET section_order = section_order + 1
     WHERE page_layout_id = v_target.id AND is_deleted IS NOT TRUE AND section_order > v_at;

    INSERT INTO public.page_layout_sections
      (page_layout_id, section_order, section_label, section_columns,
       section_is_collapsible, section_is_collapsed_by_default, section_tab,
       section_placement, created_by, updated_by)
    VALUES (v_target.id, v_at + 1, 'Support Contractor Information', v_src.section_columns,
            v_src.section_is_collapsible, v_src.section_is_collapsed_by_default,
            v_src.section_tab, v_src.section_placement, v_user, v_user)
    RETURNING id INTO v_section;

    INSERT INTO public.page_layout_widgets
      (page_layout_widget_record_number, page_layout_id, section_id, widget_type,
       widget_title, widget_column, widget_position, widget_size, widget_config,
       created_by, updated_by)
    VALUES ('', v_target.id, v_section, 'field_group', v_src.widget_title,
            v_src.widget_column, v_src.widget_position, v_src.widget_size,
            v_src_cfg, v_user, v_user);

    v_added := v_added + 1;
  END LOOP;

  RAISE NOTICE 'support contractor section added to % enrollment layouts', v_added;
END $$;

-- The invariant that was broken: an enrollment layout that ASKS the
-- support-contractor question must also be able to answer it.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(DISTINCT pl.page_layout_record_number, ', ') INTO v_bad
  FROM public.page_layouts pl
  JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
  JOIN public.page_layout_widgets  w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  WHERE pl.page_layout_object = 'enrollments' AND pl.is_deleted IS NOT TRUE
    AND w.widget_config::text LIKE '%enrollment_has_support_contractor%'
    AND NOT EXISTS (
      SELECT 1 FROM public.page_layout_sections s2
      JOIN public.page_layout_widgets w2 ON w2.section_id = s2.id AND w2.is_deleted IS NOT TRUE
      WHERE s2.page_layout_id = pl.id AND s2.is_deleted IS NOT TRUE
        AND w2.widget_config::text LIKE '%enrollment_support_contractor_account_id%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'these enrollment layouts ask for a support contractor but cannot show one: %', v_bad;
  END IF;
END $$;
