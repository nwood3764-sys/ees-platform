-- A page layout may hold fields that have no column, and the validator has to
-- know that before it can be trusted to reject the ones that are genuinely wrong.
--
-- Found while cloning the Wisconsin incentive application layouts into North
-- Carolina and Michigan: clone_page_layout() re-INSERTs every widget, which
-- re-runs validate_page_layout_widget_config(), and it rejected the clone with
--
--   page layout widget …: field_group references column "ia_business_entity_name"
--   which does not exist on table "incentive_applications"
--
-- It does not exist, and it is not supposed to. Two platform features put fields
-- on a layout that deliberately have no physical column, and the validator knew
-- about neither:
--
--   1. RELATED FIELDS THAT KEEP THEIR OWN NAME. The validator recognises a
--      related field only by the dotted `fk_column.column` spelling. The
--      incentive application and enrollment conversions of 2026-07-29
--      (20260729153704, 20260729031631) deliberately did NOT use dotted names —
--      several ia_* fields resolve to the same source column, and under a dotted
--      name they would collide — so they kept the original name and carry
--      `type: 'related_field'` with a `related` object naming fk_column/table/
--      column. 20 such fields on the incentive application layouts today.
--
--   2. INHERITED, FORMULA AND ROLL-UP FIELDS. These are declared in
--      field_metadata (fm_field_kind) and computed at read time; the physical
--      column is dropped precisely because the value lives on the parent. Three
--      on incentive_applications (the business-entity name/phone/email, resolved
--      two hops to the owner account).
--
-- Both were reachable before this only because the trigger fires per widget row
-- and the 2026-07-29 conversions rewrote widget_config in place, one UPDATE at a
-- time, on rows that already existed. The moment anything re-inserts those
-- widgets — a clone, an export/import, the Setup "Clone Layout" button — the
-- layout became un-clonable. This is not an incentive-application problem; it
-- was true for every layout carrying an inherited or renamed related field.
--
-- Everything else about the function is byte-identical to the definition it
-- replaces: same child_lookup branch, same dotted-name branch, same related_list
-- checks, same error text and errcode. The two new branches only ever ACCEPT a
-- field the old function rejected — no layout that validated before can fail now.
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
  v_field        jsonb;
  v_ftype        text;
  v_rel          jsonb;
  v_cl_child     text;
  v_cl_fk        text;
  v_cl_hop       text;
  v_cl_table     text;
  v_cl_col       text;
begin
  if tg_op = 'UPDATE' and new.is_deleted = true and old.is_deleted = false then
    return new;
  end if;

  select pl.page_layout_object into v_parent_table
  from public.page_layouts pl
  where pl.id = new.page_layout_id;

  if v_parent_table is null then
    return new;
  end if;

  if new.widget_type = 'field_group' and new.widget_config ? 'fields' then
    for v_field in
      select f from jsonb_array_elements(new.widget_config->'fields') f
    loop
      v_field_name := jsonb_extract_path_text(v_field, 'name');
      if v_field_name is null or v_field_name = '' then
        continue;
      end if;
      v_ftype := jsonb_extract_path_text(v_field, 'type');
      v_rel   := v_field->'related';

      if v_ftype = 'related_field' and v_rel is not null
         and (v_rel->>'source') = 'child_lookup' then
        v_cl_child := v_rel->>'child_table';
        v_cl_fk    := v_rel->>'child_fk';
        v_cl_hop   := v_rel->>'hop_column';
        v_cl_table := v_rel->>'table';
        v_cl_col   := v_rel->>'column';

        if v_cl_child is null or not exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname='public' and c.relname=v_cl_child and c.relkind in ('r','v','m','p','f')
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — child_table "%" does not exist',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_child,'(null)') using errcode='22023';
        end if;

        if v_cl_fk is null or not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_cl_child and a.attname=v_cl_fk and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — child_fk "%" does not exist on "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_fk,'(null)'), v_cl_child using errcode='22023';
        end if;

        if v_cl_hop is null or not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_cl_child and a.attname=v_cl_hop and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — hop_column "%" does not exist on "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_hop,'(null)'), v_cl_child using errcode='22023';
        end if;

        if v_cl_table is null or not exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname='public' and c.relname=v_cl_table and c.relkind in ('r','v','m','p','f')
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — table "%" does not exist',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_table,'(null)') using errcode='22023';
        end if;

        if v_cl_col is null or not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_cl_table and a.attname=v_cl_col and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: child_lookup field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_cl_col,'(null)'), v_cl_table using errcode='22023';
        end if;

        continue;
      end if;

      -- NEW (1): a related field that kept its own name instead of the dotted
      -- spelling. It is still a parent reference and is validated as one — the
      -- fk_column must be a single-column foreign key on this layout's object,
      -- the table it points at must be the one the config names, and the source
      -- column must exist there. Same three checks the dotted branch makes,
      -- reading the FK from the config rather than from the field name.
      if v_ftype = 'related_field' and v_rel is not null and (v_rel ? 'fk_column') then
        v_rel_fk  := v_rel->>'fk_column';
        v_rel_col := v_rel->>'column';

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
          raise exception 'page layout widget %.%: related field "%" — column "%" is not a foreign key on table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_rel_fk,'(null)'), v_parent_table using errcode='22023';
        end if;

        if (v_rel ? 'table') and (v_rel->>'table') is distinct from v_ref_table then
          raise exception 'page layout widget %.%: related field "%" — "%" points at table "%", not "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, v_rel_fk, v_ref_table, (v_rel->>'table') using errcode='22023';
        end if;

        if v_rel_col is null or not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_ref_table and a.attname=v_rel_col and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: related field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, coalesce(v_rel_col,'(null)'), v_ref_table using errcode='22023';
        end if;

        continue;
      end if;

      if position('.' in v_field_name) > 0 then
        v_rel_fk  := split_part(v_field_name, '.', 1);
        v_rel_col := split_part(v_field_name, '.', 2);

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
          raise exception 'page layout widget %.%: related field "%" — column "%" is not a foreign key on table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, v_rel_fk, v_parent_table using errcode='22023';
        end if;

        if not exists (
          select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=v_ref_table and a.attname=v_rel_col and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: related field "%" — column "%" does not exist on referenced table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, v_rel_col, v_ref_table using errcode='22023';
        end if;
      elsif not exists (
        select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=v_parent_table and a.attname=v_field_name and a.attnum>0 and not a.attisdropped
      ) then
        -- NEW (2): before rejecting, check whether the field is a VIRTUAL one
        -- declared in field_metadata — inherited, formula or roll-up. Those are
        -- computed at read time and have no physical column by design, which is
        -- the whole point of the field-types system. Only a non-standard
        -- fm_field_kind qualifies: a 'standard' row names a real column and must
        -- still fail here if that column has gone.
        if not exists (
          select 1 from public.field_metadata fm
          where fm.fm_object = v_parent_table
            and fm.fm_column = v_field_name
            and fm.fm_is_deleted is not true
            and coalesce(fm.fm_field_kind, 'standard') <> 'standard'
        ) then
          raise exception 'page layout widget %.%: field_group references column "%" which does not exist on table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_field_name, v_parent_table using errcode='22023';
        end if;
      end if;
    end loop;
  end if;

  if new.widget_type = 'related_list' then
    v_child_table := new.widget_config->>'table';
    v_fk_column   := new.widget_config->>'fk';

    if v_child_table is null or v_child_table = '' then
      raise exception 'page layout widget %.%: related_list missing widget_config.table',
        new.page_layout_id, coalesce(new.widget_title,'(untitled)') using errcode='22023';
    end if;

    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname=v_child_table and c.relkind in ('r','v','m','p','f')
    ) then
      raise exception 'page layout widget %.%: related_list references child table "%" which does not exist',
        new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_child_table using errcode='22023';
    end if;

    if v_fk_column is null or v_fk_column = '' then
      raise exception 'page layout widget %.%: related_list missing widget_config.fk',
        new.page_layout_id, coalesce(new.widget_title,'(untitled)') using errcode='22023';
    end if;

    if not exists (
      select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_child_table and a.attname=v_fk_column and a.attnum>0 and not a.attisdropped
    ) then
      raise exception 'page layout widget %.%: related_list FK column "%" does not exist on child table "%"',
        new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_fk_column, v_child_table using errcode='22023';
    end if;

    if new.widget_config ? 'columns' then
      for v_col_name in
        select jsonb_extract_path_text(c, 'name')
        from jsonb_array_elements(new.widget_config->'columns') c
        where jsonb_extract_path_text(c, 'name') is not null
          and jsonb_extract_path_text(c, 'name') <> ''
      loop
        if not exists (
          select 1 from pg_attribute a join pg_class c2 on c2.oid=a.attrelid join pg_namespace n on n.oid=c2.relnamespace
          where n.nspname='public' and c2.relname=v_child_table and a.attname=v_col_name and a.attnum>0 and not a.attisdropped
        ) then
          raise exception 'page layout widget %.%: related_list column "%" does not exist on child table "%"',
            new.page_layout_id, coalesce(new.widget_title,'(untitled)'), v_col_name, v_child_table using errcode='22023';
        end if;
      end loop;
    end if;
  end if;

  return new;
end$function$;

NOTIFY pgrst, 'reload schema';
