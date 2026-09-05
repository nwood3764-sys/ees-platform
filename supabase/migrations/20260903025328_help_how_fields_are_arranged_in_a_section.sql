-- ---------------------------------------------------------------------------
-- Help: how a page-layout section arranges its fields, and two articles that
-- promised the model that caused the staggered rows
-- ---------------------------------------------------------------------------
-- HA-00116 told admins "Place a field in Left, Center or Right and order it
-- within that column — the record page honors the exact column and order you
-- set." The record page never honored both: it read the column as a pinned slot
-- in a row-major grid and left an empty cell wherever the pinned column and the
-- reading order disagreed. Corrected in place, not appended to — a wrong
-- instruction is worse than a missing one.
--
-- HA-00065 still described the right rail as 320px collapsing to a single
-- column. It has been 480px since 2026-07-26 and now renders two.
-- ---------------------------------------------------------------------------

insert into public.help_articles
  (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published)
values (
  'HA-00210',
  'page-layout-field-arrangement',
  'How a section arranges its fields',
  'Fields fill a section left to right and wrap — the order you drag them into is the layout. Rows never stagger.',
  $md$
# How a section arranges its fields

A section on a record page is a grid of **rows**. Fields fill it the way text
fills a page: left to right, then wrap to the next row. **The order the fields
are in IS the layout** — there is no separate "which column" setting to keep in
step with it.

## Setting a section's width

Each section header in the page-layout builder has a **Columns** selector: 1, 2
or 3. That is the widest the section will ever be. Where the section is narrow —
the right sidebar, a phone — it drops columns to keep each field readable, so a
3-column section renders as 2 in the sidebar and 1 on a phone. You design at the
full width; the record page fits it to the space it has.

## Moving a field

Drag its tile. Drop it on another tile to put it in that position, or on the
empty space in the group to send it to the end. Fields shuffle up to close the
gap — you cannot leave a hole by accident.

## Making a field span the row

Each tile has a **↔** button. Turn it on and the field takes the whole row —
right for a long note, an address block, or a checkbox list that mirrors a paper
form. Turn it off to put it back in a single column.

## Rows never stagger

Two things used to make a section look broken, and both are now impossible:

- **An empty slot in the middle.** A field could be pinned to the right-hand
  column while the field before it was pinned to the left, and the page had no
  way to draw them side by side — it dropped the second one to the next row and
  left the space beside each of them blank. Position is now a single fact, so
  there is nothing left to disagree.
- **Separators at different heights.** Each field used to draw its own dividing
  line under itself, so a value that wrapped to three lines pushed its line far
  below its neighbour's and the section read as a broken ladder. The **row**
  draws the line now, and every field in a row is stretched to the same depth.

## Empty slots

Some sections show an **Empty slot** tile. Those are deliberate blanks left over
from layouts built as uneven columns — for example, an account whose billing
address runs five fields down the left while the right-hand columns hold three.
They keep those layouts looking the way they were built. Delete one and the
fields after it move up. They are dropped automatically when a section is too
narrow to hold its full column count, so they never leave a blank band on a
phone or in the sidebar.

## If a field is not where you expect

- Check you opened the layout for that record's **record type** — an object has
  one layout per record type.
- Check the section is not **Collapsed by default**.
- Check the field is not hidden for your role by field permissions.
$md$,
  'Administration', 'admin', true
);

-- ── HA-00116: the column model it described is gone ────────────────────────
update public.help_articles
   set ha_body_markdown = replace(
         ha_body_markdown,
         '- **Canvas (center)** — the live layout: sections, each split into its real columns (Left / Center / Right). Drag a field within a column to reorder it, or across columns to move it. Set a section''s **column count** in its header.',
         '- **Canvas (center)** — the live layout, drawn exactly as the record page draws it: fields fill each section left to right and wrap. Drag a field tile onto another to move it there, or onto the empty space to send it to the end. Set a section''s **column count** in its header.'),
       ha_updated_at = now()
 where ha_record_number = 'HA-00116';

update public.help_articles
   set ha_body_markdown = replace(
         ha_body_markdown,
         '## Columns are real
A section shows its actual columns. Place a field in Left, Center or Right and order it within that column — the record page honors the exact column and order you set.',
         '## The order is the layout
A field has no column of its own — where it lands is decided by its position in
the section, so what you drag is what the record page draws. Rows always fill
completely: you cannot leave an empty slot in the middle by accident. Use a
tile''s **↔** button to make a field span the whole row. See *How a section
arranges its fields*.'),
       ha_updated_at = now()
 where ha_record_number = 'HA-00116';

update public.help_articles
   set ha_body_markdown = replace(
         ha_body_markdown,
         'The record page picks up the change on its next load (hard-refresh if a stale cache lingers).',
         'The record page picks up the change on its next load.'),
       ha_updated_at = now()
 where ha_record_number = 'HA-00116';

-- ── HA-00065: the rail has been 480px since 2026-07-26 ─────────────────────
update public.help_articles
   set ha_body_markdown = replace(
         ha_body_markdown,
         'but they render in a 320px column, so two- and three-column field grids will collapse to one column for readability.',
         'but they render in a 480px column, so a three-column section renders as two there and a two-column section keeps both.'),
       ha_updated_at = now()
 where ha_record_number = 'HA-00065';

update public.help_articles
   set ha_body_markdown = replace(
         ha_body_markdown,
         'On screens narrower than 1024px the right sidebar stacks below the main content automatically.',
         'On screens narrower than 1280px the right sidebar stacks below the main content automatically, and its sections widen to the full page.'),
       ha_updated_at = now()
 where ha_record_number = 'HA-00065';

-- ── Assertions — a correction that silently failed is worse than none ──────
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.help_articles
   where ha_record_number = 'HA-00116' and ha_is_deleted is not true
     and (ha_body_markdown like '%Columns are real%'
       or ha_body_markdown like '%Left / Center / Right%'
       or ha_body_markdown like '%hard-refresh%');
  if v_bad > 0 then
    raise exception 'HA-00116 still describes the column-fill model';
  end if;

  select count(*) into v_bad from public.help_articles
   where ha_record_number = 'HA-00065' and ha_is_deleted is not true
     and (ha_body_markdown like '%320px%' or ha_body_markdown like '%1024px%');
  if v_bad > 0 then
    raise exception 'HA-00065 still describes the 320px right rail';
  end if;

  select count(*) into v_bad from public.help_articles
   where ha_record_number = 'HA-00210' and ha_is_deleted is not true and ha_is_published;
  if v_bad <> 1 then
    raise exception 'HA-00210 was not published';
  end if;
end $$;
