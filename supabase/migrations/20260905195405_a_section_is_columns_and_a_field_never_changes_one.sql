-- ---------------------------------------------------------------------------
-- A section is COLUMNS, and a field never changes one (HA-00210 corrected)
-- ---------------------------------------------------------------------------
-- Nicholas, 2026-09-05, after three cuts of this: "I can't move one field and
-- have five other fields move around. I just don't understand how that's
-- logical. For a UI."
--
-- He was describing the MODEL, not the drop target. A field's position was its
-- index in one array and the renderer packs that array into rows left to right,
-- so pulling a field out of the middle shifted every field after it by one --
-- which in a two-column section put every one of them on the OTHER SIDE of the
-- card. Moving Building one place rewrote five fields' columns. No drop-target
-- fix helps: the ripple is what a flow IS.
--
-- The section is now read as what it looks like: `cols` independent column
-- stacks. A drop names a position in a COLUMN; that column makes room below it;
-- the column the field came from closes up; nothing else moves and no field
-- ever changes column on its own. The stored array is unchanged in shape -- the
-- columns are interleaved back into it row by row -- so the record page and
-- every downstream reader are untouched.
--
-- Client-side only (src/lib/fieldGroupPlacement.js and the canvas editor); no
-- schema change. What changes here is the help article, which described the
-- flow: "the fields after it move along one place and the rows re-fill".
-- ---------------------------------------------------------------------------

update public.help_articles
set ha_summary = 'A section is columns. Drag a field where you want it: the column you drop into makes room, the column you took it from closes up, and a field never changes column unless you drag it to another one.',
    ha_body_markdown = $md$
# How a section arranges its fields

A section on a record page is a set of **columns**. Each column is its own list
of fields, top to bottom, and the rows line up across them.

## Setting a section's width

Each section header in the page-layout builder has a **Columns** selector: 1, 2
or 3. That is the widest the section will ever be. Where the section is narrow —
the right sidebar, a phone — it drops columns to keep each field readable, so a
3-column section renders as 2 in the sidebar and 1 on a phone. You design at the
full width; the record page fits it to the space it has.

## Moving a field

Pick a field up by its **⠿** handle and drop it where you want it.

- **The field goes exactly where you dropped it.**
- **The column you dropped into makes room** — that field and the ones under it
  slide down one place, within that column.
- **The column you took it from closes up.**
- **Nothing else moves.** A field never changes column unless you drag it to
  another column, and no two fields ever trade places.

So to put a field in the right-hand column, drag it onto the field in the
right-hand column that you want it above. To reorder a column, drag a field up
or down inside it — the other column does not notice.

- **To put a field at the bottom of a column**, drop it on the strip that
  appears under that column while you are dragging.
- **Dropping on an empty slot** fills that slot and moves nothing at all.
- **Dropping somewhere that isn't a field** — the gap between two rows, say —
  sends the field to the bottom of the column it is already in. A near miss
  never moves a field sideways.

Dragging a field into a **different section** works the same way: it leaves the
column it came from, which closes up, and lands in the column you dropped it on.

## Leaving a cell blank on purpose

Press **+ Empty slot** under a section to add one, then drag it where you want
the gap. An empty slot is a real, deliberate blank: it holds a cell open so the
fields around it stay exactly where you put them. A field dropped on an empty
slot **takes** it, and nothing else in the section moves. Delete a slot with its
**×** and the fields under it in that column move up.

Empty slots are dropped automatically when a section is too narrow to render its
full column count, so a deliberate blank never leaves an empty band on a phone or
in the right sidebar.

## Making a field span the row

Each tile has a **↔** button. Turn it on and the field takes the whole row —
right for a long note, an address block, or a checkbox list that mirrors a paper
form. A full-width field belongs to no column: it is a row of its own, and it
divides the columns above it from the columns below it. Turn it off to put the
field back in a single column.

## Rows never stagger

Two things used to make a section look broken, and both are now impossible:

- **An accidental blank in the middle.** A field could be pinned to the
  right-hand column while the field before it was pinned to the left, and the
  page had no way to draw them side by side — it dropped the second one to the
  next row and left the space beside each of them blank. A blank you see today is
  one somebody placed.
- **Separators at different heights.** Each field used to draw its own dividing
  line under itself, so a value that wrapped to three lines pushed its line far
  below its neighbour's and the section read as a broken ladder. The **row**
  draws the line now, and every field in a row is stretched to the same depth.

## If a field is not where you expect

- Check you opened the layout for that record's **record type** — an object has
  one layout per record type.
- Check the section is not **Collapsed by default**.
- Check the field is not hidden for your role by field permissions.
$md$,
    ha_updated_at = now()
where ha_record_number = 'HA-00210'
  and ha_is_deleted is not true;

do $$
declare v_body text;
begin
  select ha_body_markdown into v_body
  from public.help_articles
  where ha_record_number = 'HA-00210' and ha_is_deleted is not true;

  if v_body is null then
    raise exception 'HA-00210 not found — the field arrangement article was not corrected';
  end if;
  if v_body not like '%A field never changes column%' then
    raise exception 'HA-00210 does not state the column rule';
  end if;
  if v_body not like '%The column you took it from closes up%' then
    raise exception 'HA-00210 does not say what happens to the source column';
  end if;
  if v_body not like '%bottom of the column it is already in%' then
    raise exception 'HA-00210 does not say what a near miss does';
  end if;
  -- CONTROLS: every claim the column model makes false must be GONE, not merely
  -- outnumbered by newer text further down the page.
  if v_body like '%swap%' or v_body like '%Swap%' then
    raise exception 'HA-00210 still describes a swap, which no longer exists';
  end if;
  if v_body like '%move along one place%' or v_body like '%rows re-fill%' then
    raise exception 'HA-00210 still describes the flow, where one move re-columns the rest';
  end if;
  if v_body like '%you cannot leave a hole by accident%' then
    raise exception 'HA-00210 still promises that a hole cannot be left';
  end if;
end $$;
