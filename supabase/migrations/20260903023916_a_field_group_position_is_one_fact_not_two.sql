-- ---------------------------------------------------------------------------
-- A field's position in a page-layout section is ONE fact, not two
-- ---------------------------------------------------------------------------
-- Nicholas, 2026-09-03, on ACC "Service Provider Information":
--   "We shouldn't have staggered rows on page layouts... There's only one field
--    on each side, but they're staggered. This can't happen."
--
-- That section holds exactly two fields and stored them like this:
--     [ {name: account_fein,               column: 2},
--       {name: account_tax_classification, column: 1} ]
--
-- Two facts described one position — the field's INDEX (its reading order) and
-- a `column` number — and nothing kept them in agreement. The page-layout
-- EDITOR wrote `column` as a column-FILL model (three drop zones, each an
-- independent stack, order between them meaningless). The record PAGE read it
-- as a row-MAJOR grid and set `grid-column-start` from it. CSS grid places an
-- item in the first cell at or after its cursor, so a field pinned to column 1
-- sitting BEHIND one pinned to column 2 could not go beside it: it dropped to
-- the next row and left the cell next to its neighbour EMPTY. Two fields, four
-- quarters, two of them blank. That is the stagger, and it is structural — the
-- same disagreement is spread across the platform.
--
-- The fix is to stop storing the second fact. A field's index is its position;
-- which column that lands in is derived at render time by
-- src/lib/fieldGroupLayout.js, which the record page AND the layout editor now
-- both render from, so they cannot disagree again.
--
-- Removing `column` means the array order has to carry what the column
-- assignment used to say, so each group is first rewritten into the order it is
-- READ in today:
--
--   * A group whose fields ALL carry a column (224 of them) was a genuine
--     column-fill layout and its columns are frequently semantic — an account's
--     billing address is a four-field stack in column 1 beside contact methods
--     in column 2. Those are linearised row by row across the stacks, so the
--     layout an admin built is preserved exactly. Where one column runs out
--     before another the empty cell becomes an explicit `spacer` (the layout
--     field type that already exists for this), EXCEPT at the very end, where
--     it is dropped — the renderer pads a short final row itself.
--
--   * A group carrying `full_width` or layout:'rows' (28) was authored
--     row-major against a source form; its array order already IS its reading
--     order and is left alone.
--
--   * A group whose fields only PARTLY carry a column (24) never had a coherent
--     column model — the missing ones were about to be assigned round-robin by
--     the editor on next load — so array order stands.
--
--   * A group with no columns at all (752) is untouched. It already rendered in
--     array order.
--
-- No hole anywhere on the platform was authored deliberately: there are ZERO
-- `spacer` fields in the 1,078 stored field groups and the editor has never had
-- a control that could author one. Every blank slot on a record page today is
-- an accident of the two-fact model, which is why closing them needs no
-- per-layout judgement.
-- ---------------------------------------------------------------------------

do $$
declare
  v_w            record;
  v_fields       jsonb;
  v_cols         int;
  v_n            int;
  v_has_full     boolean;
  v_rows_mode    boolean;
  v_all_columns  boolean;
  v_maxlen       int;
  v_out          jsonb;
  v_f            jsonb;
  v_c            int;
  v_r            int;
  v_len          int;
  v_stack        jsonb;
  v_changed      int := 0;
  v_reordered    int := 0;
  v_spacers      int := 0;
begin
  for v_w in
    select w.id, w.widget_config, coalesce(s.section_columns, 2) as scols
    from public.page_layout_widgets w
    join public.page_layout_sections s on s.id = w.section_id
    where w.widget_type = 'field_group'
      and w.is_deleted is not true
      and jsonb_typeof(w.widget_config->'fields') = 'array'
      and jsonb_array_length(w.widget_config->'fields') > 0
  loop
    v_fields := v_w.widget_config->'fields';
    v_n      := jsonb_array_length(v_fields);
    v_cols   := greatest(1, v_w.scols);

    select bool_or(coalesce((f->>'full_width')::boolean, false)),
           bool_and((f->>'column') is not null
                    and (f->>'column') ~ '^[0-9]+$'
                    and (f->>'column')::int between 1 and v_cols)
      into v_has_full, v_all_columns
      from jsonb_array_elements(v_fields) f;

    v_rows_mode := coalesce(v_w.widget_config->>'layout', '') = 'rows';

    if v_cols > 1 and v_all_columns and not v_has_full and not v_rows_mode then
      -- Column-fill: walk the stacks row by row, emitting a spacer wherever a
      -- stack has run out. The result read left-to-right, top-to-bottom is the
      -- exact order this section reads on screen today.
      select max(cnt) into v_maxlen from (
        select count(*) as cnt
        from jsonb_array_elements(v_fields) f
        group by (f->>'column')::int
      ) t;

      v_out := '[]'::jsonb;
      for v_r in 0 .. v_maxlen - 1 loop
        for v_c in 1 .. v_cols loop
          select jsonb_agg(f order by ord) into v_stack
          from jsonb_array_elements(v_fields) with ordinality t(f, ord)
          where (f->>'column')::int = v_c;
          v_len := coalesce(jsonb_array_length(v_stack), 0);
          if v_r < v_len then
            v_out := v_out || jsonb_build_array(v_stack -> v_r);
          else
            v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'spacer'));
          end if;
        end loop;
      end loop;

      -- Trailing blanks need no placeholder: packFieldGroupRows pads a short
      -- final row itself, and a stored spacer there would be one more thing an
      -- admin has to delete to add a field.
      while jsonb_array_length(v_out) > 0
        and (v_out -> (jsonb_array_length(v_out) - 1) ->> 'type') = 'spacer'
      loop
        v_out := v_out - (jsonb_array_length(v_out) - 1);
      end loop;

      if v_out is distinct from v_fields then v_reordered := v_reordered + 1; end if;
      v_spacers := v_spacers + (select count(*) from jsonb_array_elements(v_out) f
                                where (f->>'type') = 'spacer')::int;
      v_fields := v_out;
    end if;

    -- Strip the derived fact from every group, whichever branch it took.
    v_out := '[]'::jsonb;
    for v_f in select f from jsonb_array_elements(v_fields) f loop
      v_out := v_out || jsonb_build_array(v_f - 'column');
    end loop;

    if v_out is distinct from v_w.widget_config->'fields' then
      update public.page_layout_widgets
         set widget_config = jsonb_set(widget_config, '{fields}', v_out)
       where id = v_w.id;
      v_changed := v_changed + 1;
    end if;
  end loop;

  raise notice 'field groups rewritten: %, of which re-ordered from column-fill: %, spacers written: %',
    v_changed, v_reordered, v_spacers;
end $$;

-- ── Assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_left int;
begin
  select count(*) into v_left
  from public.page_layout_widgets w, jsonb_array_elements(coalesce(w.widget_config->'fields','[]'::jsonb)) f
  where w.widget_type = 'field_group' and w.is_deleted is not true and (f ? 'column');
  if v_left > 0 then
    raise exception 'a field group still carries a derived `column` on % field(s)', v_left;
  end if;

  -- A spacer must stay nameless: the widget-config validator skips a field with
  -- no name, and a named one would be checked against the object's columns and
  -- rejected.
  select count(*) into v_left
  from public.page_layout_widgets w, jsonb_array_elements(coalesce(w.widget_config->'fields','[]'::jsonb)) f
  where w.widget_type = 'field_group' and w.is_deleted is not true
    and (f->>'type') = 'spacer' and coalesce(f->>'name','') <> '';
  if v_left > 0 then
    raise exception '% spacer field(s) carry a name', v_left;
  end if;

  -- No group may END on a spacer — the renderer pads a short final row itself.
  select count(*) into v_left
  from public.page_layout_widgets w
  where w.widget_type = 'field_group' and w.is_deleted is not true
    and jsonb_typeof(w.widget_config->'fields') = 'array'
    and jsonb_array_length(w.widget_config->'fields') > 0
    and (w.widget_config->'fields' -> (jsonb_array_length(w.widget_config->'fields') - 1) ->> 'type') = 'spacer';
  if v_left > 0 then
    raise exception '% field group(s) end on a spacer', v_left;
  end if;

  -- The reported section itself: two fields, one row, tax classification first
  -- (it was the field pinned to column 1), FEIN beside it.
  select count(*) into v_left
  from public.page_layout_widgets w
  join public.page_layout_sections s on s.id = w.section_id
  join public.page_layouts l on l.id = w.page_layout_id
  where l.page_layout_object = 'accounts' and s.section_label = 'Service Provider Information'
    and w.widget_type = 'field_group' and w.is_deleted is not true and s.is_deleted is not true
    and l.is_deleted is not true
    and w.widget_config->'fields' @> '[{"name":"account_tax_classification"}]'::jsonb
    and (w.widget_config->'fields' -> 0 ->> 'name') = 'account_tax_classification'
    and (w.widget_config->'fields' -> 1 ->> 'name') = 'account_fein';
  if v_left < 1 then
    raise exception 'the reported Service Provider Information section was not rewritten';
  end if;
end $$;
