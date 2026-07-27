-- ============================================================================
-- Page-layout save: atomicity + related-field FK validation fix
-- (2026-07-27)
--
-- Two independent defects combined to WIPE an opportunity page layout when a
-- user added a cross-object related field (building_id.building_name):
--
--   1) FALSE-POSITIVE VALIDATION. validate_page_layout_widget_config() resolves
--      a related field's FK column via information_schema
--      (constraint_column_usage / key_column_usage). Those views are
--      PRIVILEGE-FILTERED: the trigger runs SECURITY INVOKER, so during a real
--      save it executes as the `authenticated` role, which cannot see the FK
--      metadata and the lookup returns NULL. The trigger then wrongly raised
--      'column "building_id" is not a foreign key on table "opportunities"'
--      even though it demonstrably IS a foreign key. (Verified: the same query
--      returns the FK as the owner role and 0 rows as `authenticated`.)
--      FIX: resolve FK + referenced-column metadata via pg_catalog, which is
--      not privilege-filtered — identical result for every role.
--
--   2) NON-ATOMIC SAVE. The client save adapter soft-deleted ALL of a layout's
--      sections/widgets in one request, then recreated them one row at a time
--      in separate requests. When the recreate hit defect #1 mid-way, the
--      deletes had already committed — leaving the layout empty.
--      FIX: save_page_layout_from_canvas() performs the delete + recreate in a
--      SINGLE function invocation (one transaction). Any failure — this
--      validation trigger or anything else — rolls the whole thing back, so the
--      existing layout is left untouched. A failed save can no longer destroy a
--      layout, regardless of any future validation bug.
-- ============================================================================

-- ─── Fix #1: FK validation via pg_catalog (privilege-independent) ────────────
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
  --
  -- FK + column metadata is read from pg_catalog, NOT information_schema:
  -- information_schema.{constraint_column_usage,key_column_usage,columns} are
  -- privilege-filtered, so this SECURITY INVOKER trigger (running as the
  -- authenticated end user on save) cannot see FKs to tables it doesn't own.
  -- pg_catalog is readable by every role and returns the same answer.
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

        -- Resolve the table that a single-column FK on the parent references.
        select cr.relname into v_ref_table
        from pg_constraint con
        join pg_class rel      on rel.oid = con.conrelid
        join pg_namespace ns   on ns.oid  = rel.relnamespace
        join pg_class cr       on cr.oid  = con.confrelid
        join pg_attribute att  on att.attrelid = con.conrelid
                              and att.attnum   = con.conkey[1]
        where con.contype = 'f'
          and ns.nspname  = 'public'
          and rel.relname = v_parent_table
          and array_length(con.conkey, 1) = 1
          and att.attname = v_rel_fk
        limit 1;

        if v_ref_table is null then
          raise exception
            'page layout widget %.%: related field "%" — column "%" is not a foreign key on table "%"',
            new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
            v_field_name, v_rel_fk, v_parent_table
          using errcode = '22023';
        end if;

        if not exists (
          select 1
          from pg_attribute a
          join pg_class c    on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = v_ref_table
            and a.attname = v_rel_col
            and a.attnum > 0
            and not a.attisdropped
        ) then
          raise exception
            'page layout widget %.%: related field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title, '(untitled)'),
            v_field_name, v_rel_col, v_ref_table
          using errcode = '22023';
        end if;
      elsif not exists (
        select 1
        from pg_attribute a
        join pg_class c    on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = v_parent_table
          and a.attname = v_field_name
          and a.attnum > 0
          and not a.attisdropped
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
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_child_table
        and c.relkind in ('r','v','m','p','f')
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
      select 1
      from pg_attribute a
      join pg_class c    on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_child_table
        and a.attname = v_fk_column
        and a.attnum > 0
        and not a.attisdropped
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
          select 1
          from pg_attribute a
          join pg_class c2    on c2.oid = a.attrelid
          join pg_namespace n on n.oid = c2.relnamespace
          where n.nspname = 'public'
            and c2.relname = v_child_table
            and a.attname = v_col_name
            and a.attnum > 0
            and not a.attisdropped
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

-- ─── Fix #2: atomic layout save (delete + recreate in ONE transaction) ───────
CREATE OR REPLACE FUNCTION public.save_page_layout_from_canvas(
  p_layout_id uuid,
  p_sections  jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER          -- run as the caller: RLS on page_layout_* still applies
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_stamp      timestamptz := now();
  v_section    jsonb;
  v_widget     jsonb;
  v_section_id uuid;
  v_sec_ord    int;
  v_wid_pos    int;
begin
  if p_layout_id is null then
    raise exception 'save_page_layout_from_canvas: layout id is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.page_layouts
    where id = p_layout_id and is_deleted is not true
  ) then
    raise exception 'save_page_layout_from_canvas: layout % not found', p_layout_id
      using errcode = '22023';
  end if;

  -- Soft-delete the current generation. Because this and the recreate below run
  -- in a single function call = a single transaction, ANY failure in the
  -- recreate (including the widget validation trigger) rolls this back too. The
  -- old layout is never left half-destroyed.
  update public.page_layout_widgets
     set is_deleted = true, updated_at = v_stamp
   where page_layout_id = p_layout_id and is_deleted = false;

  update public.page_layout_sections
     set is_deleted = true, updated_at = v_stamp
   where page_layout_id = p_layout_id and is_deleted = false;

  v_sec_ord := 0;
  for v_section in
    select * from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb))
  loop
    v_sec_ord := v_sec_ord + 1;

    insert into public.page_layout_sections (
      page_layout_id, section_order, section_label, section_columns,
      section_is_collapsible, section_is_collapsed_by_default,
      section_tab, section_placement
    ) values (
      p_layout_id,
      v_sec_ord,
      coalesce(nullif(v_section->>'label', ''), 'Untitled Section'),
      coalesce((v_section->>'columns')::int, 2),
      coalesce((v_section->>'isCollapsible')::boolean, false),
      coalesce((v_section->>'isCollapsedByDefault')::boolean, false),
      coalesce(nullif(v_section->>'tab', ''), 'Details'),
      coalesce(nullif(v_section->>'placement', ''), 'main')
    )
    returning id into v_section_id;

    v_wid_pos := 0;
    for v_widget in
      select * from jsonb_array_elements(coalesce(v_section->'widgets', '[]'::jsonb))
    loop
      v_wid_pos := v_wid_pos + 1;

      insert into public.page_layout_widgets (
        page_layout_widget_record_number, page_layout_id, section_id,
        widget_type, widget_title, widget_column, widget_position,
        widget_size, widget_config, widget_is_required
      ) values (
        '',                                   -- trg fills the record number
        p_layout_id,
        v_section_id,
        coalesce(nullif(v_widget->>'type', ''), 'field_group'),
        coalesce(nullif(v_widget->>'title', ''), nullif(v_section->>'label', ''), 'Section'),
        coalesce((v_widget->>'column')::int, 1),
        v_wid_pos,
        coalesce(nullif(v_widget->>'size', ''), 'medium'),
        coalesce(v_widget->'config', '{}'::jsonb),
        coalesce((v_widget->>'isRequired')::boolean, false)
      );
    end loop;
  end loop;

  return p_layout_id;
end$function$;

REVOKE ALL ON FUNCTION public.save_page_layout_from_canvas(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_page_layout_from_canvas(uuid, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
