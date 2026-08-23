-- Help article: filtering the work order photo roll-up and curating the report.
INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published
) VALUES (
  '', 'photo-filters-and-final-report',
  'Filtering Work Order Photos and Choosing What Goes in the Report',
  'Pick several work steps and several tags at once, then flag photos for the final report from the work order, the lightbox, or LEAP Pad in the field.',
$md$
# Filtering Photos and Choosing What Goes in the Report

## The two filters are multi-select

The **Photos** card on a work order rolls up every photo across all of its work steps. Two dropdowns narrow it:

- **Work step** — where the photo was captured.
- **Tag** — what the photo shows. For a photo taken against a named prompt this is the prompt's own wording ("Refrigerator Nameplate"); ad hoc photos are General, Before or After.

Both are **multi-select**. Tick as many as you want: Roof / Ceiling *and* Windows & Doors, or every exterior tag at once. Within one dropdown the choices are an **or**; between the two they are an **and** — so "Roof / Ceiling + Windows & Doors" with tag "General" shows the general photos from those two sections only.

Every option carries its own count, so the closed dropdown doubles as a summary of what the work order holds. The closed button names what you picked rather than saying "2 selected".

Clearing the last tick widens back to everything — it never leaves you with an empty grid. **Clear** resets both dropdowns at once, and the count beside it reads "12 of 72" so you always know how much is hidden.

## Marking photos for the final report

The bookmark on a photo means *include this one in the final project report*. It is an internal curation flag — it never appears on the watermark and it does not change the photo.

You can set it in four places:

1. **On any photo tile** — the bookmark in the corner.
2. **In the lightbox** — the *Include in report* button.
3. **In bulk** — press **Select**, choose photos (or filter first and press **Select all**), then **Add to report**. If everything selected is already in, the button offers **Remove from report** instead. This is what the multi-select filters are for: narrow to exactly the set you want, select all, flag them in one press.
4. **In LEAP Pad, in the field** — every photo in a work step's strip now carries the same bookmark. The technician who took the photo is the person who knows which shot proves the work, so that judgement no longer has to wait for someone at a desk.

**In report** at the top of the card filters the grid down to just the flagged photos, with a running count, so you can review the report set before it is produced.
$md$,
  'Field Operations', 'internal', true
);
