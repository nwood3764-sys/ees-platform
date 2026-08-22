-- State-specific IRA assessment record types + their page layouts.
--
-- Nicholas, 2026-08-22: "Each state needs its own record types. We don't share
-- record types. We don't share page layouts. We don't share anything between
-- states. Copy what we're doing in Wisconsin, then we'll modify what is needed."
--
-- The trigger for this was an assessment created on a North Carolina opportunity
-- (931 Tessie Street, Rocky Mount) that came out carrying WI-IRA-MF-HOMES-AUDIT,
-- because that was the only IRA multifamily assessment record type in existence.
-- Its name even doubled the program suffix -- "... - NC-IRA-MF-HOMES-AUDIT -
-- WI-IRA-MF-HOMES-AUDIT" -- because derive_assessment_name() appends the
-- assessment's record-type label to the opportunity name and the two disagreed.
--
-- Opportunity record types are already fully state-scoped (WI/NC/MI, six IRA
-- programs each). Assessments were not: every assessment record type carried
-- picklist_state = NULL, so every state saw every type. This mirrors the
-- Wisconsin pair into North Carolina and Michigan and scopes all of them by
-- state, which is what fetchAvailableRecordTypes() already filters on.
--
-- Colorado and Indiana get nothing here on purpose: neither has a single IRA
-- opportunity record type (Colorado runs Electrify Denver, Indiana nothing yet),
-- so there is no program for a state-specific assessment type to belong to.
-- They come when the programs do.
--
-- PART 1 fixes a defect in clone_page_layout that this work runs straight into.

-- ---------------------------------------------------------------------------
-- PART 1 — clone_page_layout must carry section_placement.
--
-- page_layout_sections.section_placement ('main' | 'right') decides whether a
-- section renders in the record's main flow or in the always-visible right
-- sidebar rail. The clone function never copied it, so every cloned section
-- fell back to the column default 'main'. The Wisconsin assessment layouts each
-- carry a right-rail section holding the Work Orders and Diagnostic Tests
-- related lists; cloned as-is, those cards would drop into the middle of the
-- Details tab. This also silently affected the Clone Layout button in Setup
-- (pageLayoutBuilderService.cloneFromLayout -> this same function).
--
-- Only the section INSERT changes; the rest is byte-identical to the baseline
-- definition so nothing else about cloning moves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clone_page_layout(
  p_source_layout_id uuid,
  p_new_name text,
  p_new_description text DEFAULT NULL::text,
  p_new_role_id uuid DEFAULT NULL::uuid,
  p_new_record_type_id uuid DEFAULT NULL::uuid,
  p_new_is_default boolean DEFAULT false,
  p_owner uuid DEFAULT NULL::uuid,
  p_created_by uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_layout  public.page_layouts%ROWTYPE;
  v_new_layout_id  uuid;
  v_section_map    jsonb := '{}'::jsonb;
  v_new_sec_id     uuid;
  v_sec_row        public.page_layout_sections%ROWTYPE;
  v_owner          uuid;
  v_created_by     uuid;
BEGIN
  SELECT * INTO v_source_layout
  FROM public.page_layouts
  WHERE id = p_source_layout_id AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'clone_page_layout: source layout % not found or deleted', p_source_layout_id;
  END IF;

  v_owner      := COALESCE(p_owner,      v_source_layout.page_layout_owner);
  v_created_by := COALESCE(p_created_by, v_source_layout.page_layout_created_by);

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, role_id, record_type_id, page_layout_is_default,
    page_layout_description, page_layout_owner, page_layout_created_by
  )
  VALUES (
    '', p_new_name, v_source_layout.page_layout_object,
    v_source_layout.page_layout_type, p_new_role_id, p_new_record_type_id,
    COALESCE(p_new_is_default, false),
    COALESCE(p_new_description, v_source_layout.page_layout_description),
    v_owner, v_created_by
  )
  RETURNING id INTO v_new_layout_id;

  FOR v_sec_row IN
    SELECT *
    FROM public.page_layout_sections
    WHERE page_layout_id = p_source_layout_id AND is_deleted = false
    ORDER BY section_order
  LOOP
    INSERT INTO public.page_layout_sections (
      page_layout_id, section_order, section_label, section_columns,
      section_is_collapsible, section_is_collapsed_by_default,
      section_tab, section_placement           -- <- section_placement added
    )
    VALUES (
      v_new_layout_id, v_sec_row.section_order, v_sec_row.section_label,
      v_sec_row.section_columns, v_sec_row.section_is_collapsible,
      v_sec_row.section_is_collapsed_by_default,
      v_sec_row.section_tab, v_sec_row.section_placement
    )
    RETURNING id INTO v_new_sec_id;

    v_section_map := v_section_map || jsonb_build_object(v_sec_row.id::text, v_new_sec_id::text);
  END LOOP;

  INSERT INTO public.page_layout_widgets (
    page_layout_widget_record_number, page_layout_id, section_id, widget_type,
    widget_title, widget_column, widget_position, widget_size, widget_config,
    widget_is_user_customizable, widget_is_required
  )
  SELECT
    '', v_new_layout_id, (v_section_map ->> w.section_id::text)::uuid,
    w.widget_type, w.widget_title, w.widget_column, w.widget_position,
    w.widget_size, w.widget_config, w.widget_is_user_customizable, w.widget_is_required
  FROM public.page_layout_widgets w
  WHERE w.page_layout_id = p_source_layout_id
    AND w.is_deleted = false
    AND (v_section_map ? w.section_id::text);

  RETURN v_new_layout_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clone_page_layout(uuid, text, text, uuid, uuid, boolean, uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PART 2 — the record types, and PART 3 — their layouts.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_actor       uuid;
  v_spec        record;
  v_source_rt   uuid;
  v_source_pl   uuid;
  v_new_rt      uuid;
  v_new_pl      uuid;
  v_sort        integer;
  v_made_rt     integer := 0;
  v_made_pl     integer := 0;
BEGIN
  SELECT id INTO v_actor FROM public.users
   WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Owner user not found — refusing to seed record types without an owner.';
  END IF;

  -- Each new record type mirrors one Wisconsin original exactly: same shape,
  -- same layout, same declared project record type. Only the state changes.
  FOR v_spec IN
    SELECT * FROM (VALUES
      ('NC-IRA-MF-HOMES-AUDIT', 'NC', 'WI-IRA-MF-HOMES-AUDIT'),
      ('NC-IRA-SF-HOMES-AUDIT', 'NC', 'WI-IRA-SF-HOMES-AUDIT'),
      ('MI-IRA-MF-HOMES-AUDIT', 'MI', 'WI-IRA-MF-HOMES-AUDIT'),
      ('MI-IRA-SF-HOMES-AUDIT', 'MI', 'WI-IRA-SF-HOMES-AUDIT')
    ) AS t(new_value, new_state, source_value)
  LOOP
    -- The Wisconsin original this one mirrors.
    SELECT id INTO v_source_rt
      FROM public.picklist_values
     WHERE picklist_object = 'assessments'
       AND picklist_field  = 'record_type'
       AND picklist_value  = v_spec.source_value
       AND picklist_is_active
     LIMIT 1;

    IF v_source_rt IS NULL THEN
      RAISE EXCEPTION 'Source assessment record type % not found or inactive.', v_spec.source_value;
    END IF;

    -- Guard: an opportunity record type of the same name must exist for this
    -- state. That is the program the assessment type belongs to; without it
    -- there is nothing for this record type to be an assessment OF.
    IF NOT EXISTS (
      SELECT 1 FROM public.picklist_values
       WHERE picklist_object = 'opportunities'
         AND picklist_field  = 'record_type'
         AND picklist_value  = v_spec.new_value
         AND picklist_is_active
    ) THEN
      RAISE EXCEPTION
        'No active % opportunity record type — refusing to create an assessment record type for a program that does not exist.',
        v_spec.new_value;
    END IF;

    -- Record type. Idempotent: skip if it already exists (active or not).
    SELECT id INTO v_new_rt
      FROM public.picklist_values
     WHERE picklist_object = 'assessments'
       AND picklist_field  = 'record_type'
       AND picklist_value  = v_spec.new_value
     LIMIT 1;

    IF v_new_rt IS NULL THEN
      SELECT COALESCE(max(picklist_sort_order), 0) + 10 INTO v_sort
        FROM public.picklist_values
       WHERE picklist_object = 'assessments' AND picklist_field = 'record_type';

      INSERT INTO public.picklist_values (
        picklist_object, picklist_field, picklist_value, picklist_label,
        picklist_is_active, picklist_sort_order, picklist_state,
        picklist_created_by, picklist_is_default_record_type,
        picklist_project_record_type
      )
      SELECT
        'assessments', 'record_type', v_spec.new_value, v_spec.new_value,
        true, v_sort, v_spec.new_state,
        v_actor, false,
        -- Mirror the source's declared project record type, whatever it is
        -- (the Wisconsin multifamily type declares one; the single-family type
        -- does not). derive_assessment_project() reads this.
        src.picklist_project_record_type
      FROM public.picklist_values src
      WHERE src.id = v_source_rt
      RETURNING id INTO v_new_rt;

      v_made_rt := v_made_rt + 1;
    END IF;

    -- Layout. The source's default record_detail layout, cloned wholesale.
    SELECT id INTO v_source_pl
      FROM public.page_layouts
     WHERE page_layout_object = 'assessments'
       AND page_layout_type   = 'record_detail'
       AND record_type_id     = v_source_rt
       AND is_deleted IS NOT TRUE
     ORDER BY page_layout_is_default DESC
     LIMIT 1;

    IF v_source_pl IS NULL THEN
      RAISE EXCEPTION 'No live layout for source record type % — cannot clone.', v_spec.source_value;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.page_layouts
       WHERE page_layout_object = 'assessments'
         AND page_layout_type   = 'record_detail'
         AND record_type_id     = v_new_rt
         AND is_deleted IS NOT TRUE
    ) THEN
      v_new_pl := public.clone_page_layout(
        v_source_pl,
        v_spec.new_value,
        'Assessment layout for the ' || v_spec.new_value || ' program. Cloned from '
          || v_spec.source_value || ' on 2026-08-22; edit freely — states share nothing.',
        NULL,
        v_new_rt,
        true,
        v_actor,
        v_actor
      );
      v_made_pl := v_made_pl + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Created % assessment record type(s) and % page layout(s).', v_made_rt, v_made_pl;
END $$;

NOTIFY pgrst, 'reload schema';
