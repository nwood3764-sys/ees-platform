-- ============================================================================
-- System Information section on EVERY record page layout
-- ----------------------------------------------------------------------------
-- Nicholas, 2026-08-22: "Every single record should have this: create date,
-- created by, modified or last modified date and time, last modified by user.
-- Every single page layout needs that under the System Information section. If
-- not there, create it. It must be there."
--
-- Before this migration, of 112 System Information field groups across the
-- platform only ~40 carried each of the four fields, and ~100 record layouts
-- had no System Information section at all. The two most-asked-for fields —
-- Created Date and Last Modified Date — were on fewer than half.
--
-- This runs off resolve_record_audit_columns() (previous migration), so it
-- places the object's REAL audit columns whatever they are named, and the
-- append-only logs (audit_log, field_history) get their own performed-at /
-- changed-at columns rather than a duplicate copy of the same fact.
--
-- Per layout:
--   1. Strip the four audit columns out of every field group on the layout, so
--      the fields cannot end up rendered twice when a layout already carried
--      one of them in a business section.
--   2. Find the System Information section (by section label, else by a field
--      group titled System Information); create it if absent — last in order,
--      Details tab, 2 columns, collapsible and collapsed by default, matching
--      the 110 sections that already follow that shape.
--   3. Find or create the System Information field group in that section.
--   4. Append the four fields in a fixed order: Created Date, Created By,
--      Last Modified Date, Last Modified By. Anything already in the group
--      (Record Type, Inactive, ...) keeps its place above them.
--
-- Created By / Last Modified By are `lookup` fields onto users.user_name, which
-- is how the existing System Information groups already render them, so they
-- show a person's name and hyperlink to the user record. Both date fields are
-- `datetime`, which the record renderer already treats as display-only.
-- ============================================================================

DO $seed$
DECLARE
  lay        record;
  r          record;
  v_section  uuid;
  v_widget   uuid;
  v_fields   jsonb;
  v_order    integer;
  v_position integer;
  v_layouts  integer := 0;
BEGIN
  FOR lay IN
    SELECT pl.id, pl.page_layout_object, pl.page_layout_name
    FROM public.page_layouts pl
    JOIN pg_class cl ON cl.relname = pl.page_layout_object AND cl.relkind = 'r'
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    WHERE pl.is_deleted = false AND pl.page_layout_type = 'record_detail'
    ORDER BY pl.page_layout_object, pl.page_layout_name
  LOOP
    SELECT * INTO r FROM public.resolve_record_audit_columns(lay.page_layout_object);
    CONTINUE WHEN NOT FOUND;

    -- 1) No duplicates: drop the four columns from every field group first.
    UPDATE public.page_layout_widgets w
       SET widget_config = jsonb_set(
             w.widget_config, '{fields}',
             (SELECT COALESCE(jsonb_agg(e.f ORDER BY e.ord), '[]'::jsonb)
                FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS e(f, ord)
               WHERE COALESCE(e.f->>'name', '') <> ALL (ARRAY[
                       r.created_at_column, r.created_by_column,
                       r.updated_at_column, r.updated_by_column])))
      FROM public.page_layout_sections s
     WHERE w.section_id = s.id
       AND s.page_layout_id = lay.id
       AND s.is_deleted = false
       AND w.is_deleted = false
       AND w.widget_type = 'field_group'
       AND w.widget_config ? 'fields'
       AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') AS x
              WHERE x->>'name' = ANY (ARRAY[
                      r.created_at_column, r.created_by_column,
                      r.updated_at_column, r.updated_by_column]));

    -- 2) The System Information section.
    SELECT s.id INTO v_section
    FROM public.page_layout_sections s
    WHERE s.page_layout_id = lay.id AND s.is_deleted = false
      AND s.section_label = 'System Information'
    ORDER BY s.section_order
    LIMIT 1;

    IF v_section IS NULL THEN
      SELECT s.id INTO v_section
      FROM public.page_layout_sections s
      JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted = false
      WHERE s.page_layout_id = lay.id AND s.is_deleted = false
        AND w.widget_type = 'field_group'
        AND COALESCE(w.widget_title, '') = 'System Information'
      ORDER BY s.section_order
      LIMIT 1;
    END IF;

    IF v_section IS NULL THEN
      SELECT COALESCE(max(s.section_order), 0) + 1 INTO v_order
      FROM public.page_layout_sections s
      WHERE s.page_layout_id = lay.id AND s.is_deleted = false;

      INSERT INTO public.page_layout_sections
        (page_layout_id, section_order, section_label, section_columns, section_tab,
         section_placement, section_is_collapsible, section_is_collapsed_by_default)
      VALUES (lay.id, v_order, 'System Information', 2, 'Details', 'main', true, true)
      RETURNING id INTO v_section;
    END IF;

    -- 3) The System Information field group inside it.
    SELECT w.id, w.widget_config->'fields' INTO v_widget, v_fields
    FROM public.page_layout_widgets w
    WHERE w.section_id = v_section AND w.is_deleted = false
      AND w.widget_type = 'field_group'
      AND COALESCE(w.widget_title, '') = 'System Information'
    ORDER BY w.widget_position
    LIMIT 1;

    IF v_widget IS NULL THEN
      -- The section is the System Information section; whatever single field
      -- group it already holds IS that section's group, whatever it is titled.
      SELECT w.id, w.widget_config->'fields' INTO v_widget, v_fields
      FROM public.page_layout_widgets w
      WHERE w.section_id = v_section AND w.is_deleted = false
        AND w.widget_type = 'field_group'
      ORDER BY w.widget_position
      LIMIT 1;
    END IF;

    IF v_widget IS NULL THEN
      SELECT COALESCE(max(w.widget_position), 0) + 1 INTO v_position
      FROM public.page_layout_widgets w
      WHERE w.section_id = v_section AND w.is_deleted = false;

      INSERT INTO public.page_layout_widgets
        (page_layout_widget_record_number, page_layout_id, section_id, widget_type,
         widget_title, widget_column, widget_position, widget_config)
      VALUES ('', lay.id, v_section, 'field_group', 'System Information', 1, v_position,
              jsonb_build_object('fields', '[]'::jsonb))
      RETURNING id, widget_config->'fields' INTO v_widget, v_fields;
    END IF;

    -- 4) Append the four, in order.
    UPDATE public.page_layout_widgets
       SET widget_config = jsonb_set(
             COALESCE(widget_config, '{}'::jsonb), '{fields}',
             COALESCE(v_fields, '[]'::jsonb) || jsonb_build_array(
               jsonb_build_object('name', r.created_at_column, 'type', 'datetime',
                                  'label', 'Created Date'),
               jsonb_build_object('name', r.created_by_column, 'type', 'lookup',
                                  'label', 'Created By',
                                  'lookup_table', 'users', 'lookup_field', 'user_name'),
               jsonb_build_object('name', r.updated_at_column, 'type', 'datetime',
                                  'label', 'Last Modified Date'),
               jsonb_build_object('name', r.updated_by_column, 'type', 'lookup',
                                  'label', 'Last Modified By',
                                  'lookup_table', 'users', 'lookup_field', 'user_name')))
     WHERE id = v_widget;

    v_layouts := v_layouts + 1;
    v_section := NULL; v_widget := NULL; v_fields := NULL;
  END LOOP;

  RAISE NOTICE 'System Information fields placed on % record page layout(s)', v_layouts;
END $seed$;

NOTIFY pgrst, 'reload schema';
