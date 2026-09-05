-- ---------------------------------------------------------------------------
-- A field drop INSERTS — fields never trade places (HA-00210 corrected again)
-- ---------------------------------------------------------------------------
-- Nicholas, 2026-09-05, on the swap that shipped a few hours earlier:
-- "I don't want fields to trade places ever. That's never, ever, ever a good
-- functionality. There's no reason in the world we'd ever trade places."
-- And, stating the rule: "If I move something over, it goes in between the two
-- existing fields. That's it, and then you readjust to make sure the rows are
-- horizontally aligned."
--
-- The swap was wrong for the reason he gave and for the reason he reported in
-- the first place: it threw the field you dropped onto across the section. On
-- his assessments layout, dragging Building onto Assessor Name sent Assessor
-- Name from the right-hand column of row 4 to the left-hand column of row 2 —
-- a field he never touched, on the other side of the section. That the
-- arithmetic was symmetric did not make it any less surprising.
--
-- There is one gesture now: a drop INSERTS at the position it was dropped at,
-- and the fields after it move along one place. The one target that pushes
-- nothing is an EMPTY SLOT — there is nothing there to displace, which is what
-- an empty slot is for. Every row's right-hand end also carries an insertion
-- line now, because "move the building over to the right" is a gesture aimed
-- at the end of a row and there was nothing there to drop on.
--
-- Client-side only (src/lib/fieldGroupPlacement.js and the canvas editor); no
-- schema change. What changes here is the help article, which described the
-- swap as the way to put a field in a particular column.
-- ---------------------------------------------------------------------------

update public.help_articles
set ha_summary = 'Drag a field between two fields and it goes there — the fields after it move along one place and the rows re-fill. Fields never trade places.',
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

## Moving a field

Pick a field up by its **⠿** handle and drop it **between the two fields you
want it between**. A green line shows the gap you are aiming at — down the left
edge of every field, and off the right-hand end of every row. The field lands
there, the fields after it move along one place, and the rows re-fill so they
stay whole.

That is the only rule. **Fields never trade places** — the field you drop onto
is not sent off somewhere else, it just moves along one cell.

- **To put a field in the right-hand column**, drop it off the right-hand end of
  the row above where you want it — or on the line to the left of the field
  that should follow it.
- **Dropping on a field** puts your field in front of that field.
- **Dropping below the last row** sends it to the end.

Dragging a field into a **different section** works the same way: it leaves the
section it came from, which closes up behind it, and lands where you dropped it.

## Empty slots

An **empty slot** is a deliberate blank cell. It is the one target that pushes
nothing: a field dropped on an empty slot **takes that slot**, and nothing else
in the section moves at all. Use one when you want a field in a particular cell
and everything around it left exactly where it is.

Press **+ Empty slot** under a section to add one, then drag it where you want
the gap. Delete one with its **×** and the fields after it move up.

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

do $$
declare v_body text;
begin
  select ha_body_markdown into v_body
  from public.help_articles
  where ha_record_number = 'HA-00210' and ha_is_deleted is not true;

  if v_body is null then
    raise exception 'HA-00210 not found — the field arrangement article was not corrected';
  end if;
  if v_body not like '%Fields never trade places%' then
    raise exception 'HA-00210 does not state that fields never trade places';
  end if;
  if v_body not like '%between the two fields you%' then
    raise exception 'HA-00210 does not describe the insertion gesture';
  end if;
  if v_body not like '%takes that slot%' then
    raise exception 'HA-00210 does not say an empty slot is filled rather than pushed';
  end if;
  -- CONTROLS: both claims this change makes false must be gone, not merely
  -- outnumbered by newer text further down the page.
  if v_body like '%swap%' or v_body like '%Swap%' then
    raise exception 'HA-00210 still describes a swap, which no longer exists';
  end if;
  if v_body like '%you cannot leave a hole by accident%' then
    raise exception 'HA-00210 still promises that a hole cannot be left';
  end if;
end $$;
