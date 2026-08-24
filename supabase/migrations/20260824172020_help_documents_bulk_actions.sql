-- Help article: selecting several documents on a record and acting on them at
-- once. Nicholas, 2026-08-24, from the Documents card on a Rocky Mount
-- assessment: "I need to be able to select multiple and then click the actions,
-- like download, not one at a time only."
INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published
) VALUES (
  '', 'documents-select-multiple-and-download',
  'Downloading Several Documents at Once',
  'Press Select on a record''s Documents card to tick as many files as you need, then download them as one zip or move them to the recycle bin together. A single file downloads as itself.',
$md$
# Downloading several documents at once

A record's **Documents** card can hold a whole program submission — an Asset Score report for the baseline and one for the improved case, the weather file, the models. Pulling those out one at a time is nine trips through a preview window. Select them instead.

## Select, then act

Press **Select** in the top right of the card. Every row gains a checkbox and the card's actions appear:

- **Select all (n)** — ticks every document on the card.
- **Download (n)** — see below.
- **Delete (n)** — moves the whole selection to the recycle bin.
- **Cancel** — leaves select mode and clears the ticks.

While you are selecting, clicking anywhere on a row ticks or unticks it. Rows do not open their preview until you leave select mode, so a click never costs you the selection you were building.

## What Download gives you

- **One document selected** → the file itself, under the name it was uploaded with.
- **Several selected** → a single **zip**, named after the card (a card titled "Documents" produces `documents.zip`).

Files inside the zip keep their original names. If two documents on the same card share a name, the second is numbered — `Asset Score Report (2).pdf` — so nothing is silently overwritten and the zip always contains every file you selected.

Nothing is re-encoded. What comes down is exactly what was uploaded, which is what makes a downloaded file valid to send on to a program.

## Downloading just one

You do not have to enter select mode for a single file. Hover a row and a **Download** button appears next to the delete button, and the preview window carries a **Download** button of its own.

## Deleting

Delete always asks first, and it is always a **soft delete** — the documents move to the recycle bin, where an administrator can restore them. Nothing is removed from the database.

## Photos work the same way

The **Photos** card has had Select since the work order galleries were built: tick several photos and download them as a zip, flag them for the final report, or delete them together. Photo downloads deliver the watermarked copy — the one carrying the visible step, location, date and GPS tag that the incentive programs require — with the original camera EXIF intact.
$md$,
  'Records', 'internal', true
);
