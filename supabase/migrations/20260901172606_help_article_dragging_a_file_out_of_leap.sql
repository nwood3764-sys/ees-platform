-- Help article for dragging a stored file out of a record's Files/Photos card.
--
-- Written to be honest about the ceiling: the drag reaches the desktop, not
-- another web page's upload box. Promising the direct drop would send people
-- to a program deadline believing a file was attached when it was not.

INSERT INTO public.help_articles
  (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
   ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by)
SELECT '', 'dragging-a-file-out-of-leap',
  'Dragging a file out of LEAP',
  'Drag a document or photo straight from a record onto your desktop, instead of downloading it and hunting for the download.',
$md$
# Dragging a file out of LEAP

Any file on a record's **Files** or **Photos** card can be dragged straight out
of LEAP onto your desktop or into a folder. Press on the row (or the photo
tile), drag it out of the browser window, and let go. The file lands under its
own name — a document keeps the name it was uploaded with, a photo comes down
as the watermarked evidence file with its capture time and GPS intact, exactly
as the Download button produces it.

This is a shortcut for one thing: getting a file onto your computer without
downloading it and then going to find the download.

## What it does not do

**You cannot drag a file from LEAP directly into another website's upload box.**
Dragging onto a form on another tab — a program's application form, a Jotform,
a webmail attachment area — hands that site a link, not the file, and the site
will ignore it. This is a browser rule, not something LEAP can switch on.

So the route to an external form is still two steps, and the drag shortens the
first one:

1. Drag the file from LEAP onto your desktop.
2. Drag it from the desktop into the form's upload box.

## What you need

- **Chrome or Edge.** Firefox and Safari do not support dragging a file out of a
  web page; there the drag carries a link and the **Download** button is the way.
- A file that is still loaded on the card. If a record page has been open for
  several hours the file's secure link expires; moving the mouse over the card
  refreshes it automatically, so hover for a moment before dragging.

## One file at a time

A drag carries a single file. To take several at once, use **Select** and then
**Download** — that produces one zip of everything you picked.

## Which file comes out

- **Documents** come out byte-for-byte as they were uploaded, under their own
  filename. An Asset Score PDF or an `.osm` model is exactly what the program
  will receive.
- **Photos** come out as the *watermarked* copy, which carries the visible tag
  (work step, property, date, GPS) that the incentive programs require, plus
  the original camera EXIF. The untouched original stays in LEAP.

Characters a filesystem will not accept — a colon in a name like
`W-9: LSS Housing.pdf` — are replaced with a hyphen as the file is written.
$md$,
  'Records', 'all', true, u.id, u.id
FROM (SELECT id FROM public.users WHERE id='c5a01ec8-960f-42ab-8a9e-a49822de89af') u
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles
   WHERE ha_slug = 'dragging-a-file-out-of-leap' AND ha_is_deleted IS NOT TRUE);

DO $$
DECLARE n text;
BEGIN
  SELECT ha_record_number INTO n FROM public.help_articles
   WHERE ha_slug = 'dragging-a-file-out-of-leap' AND ha_is_deleted IS NOT TRUE;
  IF n IS NULL OR n NOT LIKE 'HA-%' THEN
    RAISE EXCEPTION 'help article not created, or its record number is malformed: %', n;
  END IF;
  RAISE NOTICE 'help article %', n;
END $$;
