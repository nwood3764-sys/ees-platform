-- ============================================================================
-- WYSIWYG card placement + cross-object (related) page-layout fields
-- (Nicholas, 2026-07-26)
--
-- 1) Card widgets (related lists, file galleries, conversation panels,
--    reports, publish history) now render INSIDE their section, on the tab
--    that section lives on — sections behave identically on every tab.
--    Legacy sections holding ONLY card widgets (no field group at all) were
--    authored under the old rule (cards always forced onto the Related tab)
--    and mostly sit on 'Details'; move them to 'Related' so live record
--    pages keep their exact current appearance through the renderer change.
--    Sections that carry a field group (even an empty one — the canvas
--    editor always creates one) are left alone: their cards now render
--    beside their fields, which is the new intended behavior.
--
-- 2) validate_page_layout_widget_config: field_group fields[].name may now
--    be '<fk_column>.<related_column>' — a read-only cross-object field
--    showing a value from the record a lookup points at (e.g. property HUD
--    fields on an opportunity layout). Validate the FK column exists on the
--    layout object, resolve the table it references, and validate the
--    related column exists there.
-- ============================================================================

UPDATE page_layout_sections pls
SET section_tab = 'Related', updated_at = now()
WHERE pls.is_deleted IS NOT TRUE
  AND coalesce(pls.section_tab, 'Details') <> 'Related'
  AND coalesce(pls.section_placement, 'main') = 'main'
  AND EXISTS (
    SELECT 1 FROM page_layout_widgets w
    WHERE w.section_id = pls.id AND w.is_deleted IS NOT TRUE
      AND w.widget_type IN ('related_list','file_gallery','conversation_panel','report','prtsn_history'))
  AND NOT EXISTS (
    SELECT 1 FROM page_layout_widgets w
    WHERE w.section_id = pls.id AND w.is_deleted IS NOT TRUE
      AND w.widget_type NOT IN ('related_list','file_gallery','conversation_panel','report','prtsn_history'));

CREATE OR REPLACE FUNCTION public.validate_page_layout_widget_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_parent_table text;
  v_field_name   text;
  v_child_table  text;
  v_fk_column    text;
  v_col_name     text;
  v_rel_fk       text;
  v_rel_col      text;
  v_ref_table    text;
begin
  -- Skip validation on soft-delete updates -- we don't want a layout
  -- author to be unable to delete a widget that was already broken.
  if tg_op = 'UPDATE' and new.is_deleted = true and old.is_deleted = false then
    return new;
  end if;

  -- The parent table is on the layout, not the widget. We must look it up.
  select pl.page_layout_object into v_parent_table
  from public.page_layouts pl
  where pl.id = new.page_layout_id;

  if v_parent_table is null then
    -- Layout doesn't exist or was deleted -- defer to FK constraint
    return new;
  end if;

  -- ─── field_group: validate every fields[].name ───────────────────────
  -- Plain names must exist on the parent table. Dotted names
  -- ('<fk_column>.<related_column>') are cross-object read-only fields:
  -- the FK column must exist on the parent AND be a foreign key, and the
  -- related column must exist on the table that FK references.
  if new.widget_type = 'field_group' and new.widget_config ? 'fields' then
    for v_field_name in
      select jsonb_extract_path_text(f, 'name')
      from jsonb_array_elements(new.widget_config->'fields') f
      where jsonb_extract_path_text(f, 'name') is not null
        and jsonb_extract_path_text(f, 'name') <> ''
    loop
      if position('.' in v_field_name) > 0 then
        v_rel_fk  := split_part(v_field_name, '.', 1);
        v_rel_col := split_part(v_field_name, '.', 2);

        select ccu.table_name into v_ref_table
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        where tc.table_schema = 'public'
          and tc.table_name = v_parent_table
          and tc.constraint_type = 'FOREIGN KEY'
          and kcu.column_name = v_rel_fk
        limit 1;

        if v_ref_table is null then
          raise exception
            'page layout widget %.%: related field "%" — column "%" is not a foreign key on table "%"',
            new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
            v_field_name, v_rel_fk, v_parent_table
          using errcode = '22023';
        end if;

        if not exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name   = v_ref_table
            and column_name  = v_rel_col
        ) then
          raise exception
            'page layout widget %.%: related field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
            v_field_name, v_rel_col, v_ref_table
          using errcode = '22023';
        end if;
      elsif not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name   = v_parent_table
          and column_name  = v_field_name
      ) then
        raise exception
          'page layout widget %.%: field_group references column "%" which does not exist on table "%"',
          new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
          v_field_name, v_parent_table
        using errcode = '22023';
      end if;
    end loop;
  end if;

  -- ─── related_list: validate table, fk, and every columns[].name ──────
  if new.widget_type = 'related_list' then
    v_child_table := new.widget_config->>'table';
    v_fk_column   := new.widget_config->>'fk';

    if v_child_table is null or v_child_table = '' then
      raise exception
        'page layout widget %.%: related_list missing widget_config.table',
        new.page_layout_id, coalesce(new.widget_title, '(untitled)')
      using errcode = '22023';
    end if;

    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = v_child_table
    ) then
      raise exception
        'page layout widget %.%: related_list references child table "%" which does not exist',
        new.page_layout_id, coalesce(new.widget_title, '(untitled)'), v_child_table
      using errcode = '22023';
    end if;

    if v_fk_column is null or v_fk_column = '' then
      raise exception
        'page layout widget %.%: related_list missing widget_config.fk',
        new.page_layout_id, coalesce(new.widget_title, '(untitled)')
      using errcode = '22023';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = v_child_table
        and column_name  = v_fk_column
    ) then
      raise exception
        'page layout widget %.%: related_list FK column "%" does not exist on child table "%"',
        new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
        v_fk_column, v_child_table
      using errcode = '22023';
    end if;

    if new.widget_config ? 'columns' then
      for v_col_name in
        select jsonb_extract_path_text(c, 'name')
        from jsonb_array_elements(new.widget_config->'columns') c
        where jsonb_extract_path_text(c, 'name') is not null
          and jsonb_extract_path_text(c, 'name') <> ''
      loop
        if not exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name   = v_child_table
            and column_name  = v_col_name
        ) then
          raise exception
            'page layout widget %.%: related_list column "%" does not exist on child table "%"',
            new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
            v_col_name, v_child_table
          using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;

  return new;
end$function$;

NOTIFY pgrst, 'reload schema';
