-- ---------------------------------------------------------------------------
-- A field goes where you drop it — HA-00210 corrected in place
-- ---------------------------------------------------------------------------
-- Nicholas, 2026-09-05, in the page-layout editor on the assessments
-- WI-IRA-MF-HOMES-AUDIT layout: "In hindsight, it's not even allowing me to
-- move it. I just moved the building over to the right, and it moved the
-- property, the building, and the project back to the left."
--
-- The fix is entirely client side (src/lib/fieldGroupPlacement.js and the
-- canvas editor): dropping a field ON A CELL now swaps the two occupants and
-- moves nothing else, the insertion lines in the gutters keep the re-flowing
-- behaviour for reordering, and an empty slot is both authorable and
-- draggable. No schema changes — a spacer carries no name, so
-- validate_page_layout_widget_config already skips it (proved on production in
-- a rolled-back transaction), and trg_0_strip_field_group_derived_column still
-- strips any `column` on the way in.
--
-- What DOES change here is the help article, which now describes two gestures
-- that did not exist and contradicts itself on a third. HA-00210 said "fields
-- shuffle up to close the gap — you cannot leave a hole by accident", which
-- was true and is now exactly the thing an admin is allowed to do
-- deliberately, and it said empty slots were only ever left over from older
-- layouts. Corrected in place rather than appended to: an instruction that is
-- wrong is worse than one that is missing.
-- ---------------------------------------------------------------------------

update public.help_articles
set ha_summary = 'Drop a field on another field to swap the two — nothing else moves. Drop it on the line between fields to move it there and re-flow the rest.',
    ha_body_markdown = $md$
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

## Moving a field — two gestures, and the difference matters

Pick a field up by its **⠿** handle. Where you let go decides what happens:

- **Drop it on another field — the two swap places.** The field you dragged
  takes that cell and the field that was there takes the cell you came from.
  **Nothing else in the section moves.** This is how you put a field in a
  particular column: drag it onto the field currently sitting there.
- **Drop it on the line between two fields** — the thin vertical line that
  appears in the gap while you are dragging — and the field moves to that
  position, with the fields after it re-flowing to close up behind it. This is
  the gesture for reordering a list of fields.
- **Drop it on the empty space below the last row** and it goes to the end.
- **Drop it on an empty slot, or on the blank half of a short row**, and it
  takes that cell — leaving its own cell blank.

Dragging a field into a **different section** always moves it: it leaves the
section it came from, which closes up behind it, and lands where you dropped it.

## Leaving a cell blank on purpose

Press **+ Empty slot** under a section to add one, then drag it to the cell you
want left blank — or just drag a field onto an empty slot and the slot takes the
field's old place. An empty slot is a real, deliberate blank: it holds a column
open so the fields around it stay where you put them. Delete it with its **×**
and the fields after it move up.

Empty slots are dropped automatically when a section is too narrow to render its
full column count, so a deliberate blank never leaves an empty band on a phone or
in the right sidebar.

## Making a field span the row

Each tile has a **↔** button. Turn it on and the field takes the whole row —
right for a long note, an address block, or a checkbox list that mirrors a paper
form. Turn it off to put it back in a single column.

## Rows never stagger

Two things used to make a section look broken, and both are now impossible:

- **An accidental empty slot in the middle.** A field could be pinned to the
  right-hand column while the field before it was pinned to the left, and the
  page had no way to draw them side by side — it dropped the second one to the
  next row and left the space beside each of them blank. Position is a single
  fact now, so there is nothing left to disagree. A blank you see today is one
  somebody placed.
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

-- The correction must actually have landed, and the two gestures must both be
-- described — a half-corrected instruction reads as authoritative and is not.
do $$
declare v_body text;
begin
  select ha_body_markdown into v_body
  from public.help_articles
  where ha_record_number = 'HA-00210' and ha_is_deleted is not true;

  if v_body is null then
    raise exception 'HA-00210 not found — the field arrangement article was not corrected';
  end if;
  if v_body not like '%the two swap places%' then
    raise exception 'HA-00210 does not describe the swap gesture';
  end if;
  if v_body not like '%line between two fields%' then
    raise exception 'HA-00210 does not describe the insertion line';
  end if;
  if v_body not like '%+ Empty slot%' then
    raise exception 'HA-00210 does not say an empty slot can be added';
  end if;
  -- CONTROL: the claim this change makes false must be gone, not merely
  -- outnumbered by newer text further down the page.
  if v_body like '%you cannot leave a hole by accident%' then
    raise exception 'HA-00210 still promises that a hole cannot be left, which is now the point';
  end if;
end $$;
