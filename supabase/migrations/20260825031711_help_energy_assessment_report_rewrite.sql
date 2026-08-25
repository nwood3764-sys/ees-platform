-- Rewrite HA-00187 to describe the report that actually ships.
--
-- The first draft described a document that no longer exists: it promised
-- "every section of the work plan", a deliverables list, an acknowledgment and
-- a signature block, and said unanswered questions print with an em dash. All
-- of that was removed on 2026-08-24 — the report is the building and its
-- tagged photographs. A help article that describes a different document is
-- worse than none.
UPDATE public.help_articles
   SET ha_title   = 'Producing the Energy Assessment Report',
       ha_summary = 'Where to generate the assessment report for a Multifamily Energy Assessment work order, why only some sections appear, and how to change the layout.',
       ha_body_markdown = $md$
## What this report is

The Energy Assessment Report carries the **tagged photographs** of an assessment, grouped under the system each one documents, in the order and under the headings of the DOE Audit Template report — so the two can be read side by side and the systems photos line up in both.

That is the whole document: it identifies the building, and it shows the photographs. It carries no narrative, no deliverables list, no findings section and no signature block.

## Where it lives

Open the **Multifamily Energy Assessment work order** and choose **Actions → Generate Energy Assessment Report**.

It is on the work order, not the project, because everything in it was captured on that work order. The two actions on the **project** — Generate Project Reservation Submittal and Generate Final Project Payment Request Submittal — are filings to a program administering body at a stage of that program's incentive application. That is a different thing from a deliverable.

## Which sections appear

**Only sections that have photographs.** A section with none is left out of the report entirely — no heading, no blank rows. Within a section, only questions that were actually answered are printed; unanswered ones are left out rather than shown as em dashes.

So the report is as long as the evidence is. If it comes out shorter than expected, the photographs have not been marked yet.

## Getting photographs into it

Only photos marked **Include in final report** are printed. You set that on the work order's **Photos** card: hover a photo and click the bookmark, or use **Select** to mark several at once. The card shows the running count as **In report (N)**.

Photos print with the section that captured them, so Heating Systems photos sit under Heating Systems. Anything tagged against no section still appears, under **Additional Photographs**, so nothing marked is ever dropped.

Before you generate, the dialog lists every section with its photo count and whether it will appear, plus **Sections in report: N of 15**. If a section reads *"nothing captured — left out"*, that is what will happen.

Work order and work step **status are never consulted**. A photograph that was taken is a fact whatever state the step is in.

## Generating it

Press **Generate Report**. Photos are fetched and prepared first, then the PDF is built. Then:

- **View** — opens it in a new tab to look at. Saving from that tab uses the browser's own name, so use Download to keep a copy.
- **Download** — saves it named for the building, e.g. `100 Saint Francis Court - Rocky Mount - 100 - 110 - Multifamily Energy Assessment Report.pdf`.
- **Save to Work Order** — files it on the work order's Documents card.

Generate it as often as you like; each run reads the current state of the assessment.

## The photographs are links

Every photo in the PDF links to the **original capture with its EXIF intact** — full resolution, GPS and timestamp included — so whoever receives the report can open or save it. The link is read-only: it exposes that one photograph and nothing else. It cannot reach the record, and it cannot edit or delete anything. Links stay good for a year.

Note that anyone holding the PDF can follow those links; there is no sign-in.

## Which company the report is from

The company named on the cover and in the footer follows the **state the building is in** — a Rocky Mount building is assessed by Energy Efficiency Services of North Carolina. If a building's state is not recorded, the report falls back to the unqualified name rather than naming the wrong state.

## Changing the layout

The sections, their order and their headings are a **template**, not code. Open **SDT-00006 Multifamily Building Energy Assessment Report** and choose **Edit Sections**.

Drag to reorder, rename any heading, change how many photos sit in a row, add or remove sections. A **Captured Section** names one work plan section by its exact name (for example `Heating Systems`); renaming its heading changes only the report, not the work order. Set **Photos → Leave photos to the Photo Documentation section** on a section to move its photographs to the end instead.

If a program needs different wording, use **Clone Template** and scope the copy to that program's opportunity record type. Every other program keeps the default.

## What the report does not do

It does not model energy savings, cost or payback. Those come out of the energy model and are reported in the Audit Template's own Energy Savings Opportunities section.
$md$,
       ha_updated_at = now()
 WHERE ha_slug = 'energy-assessment-report'
   AND ha_is_deleted = false;

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.help_articles
   WHERE ha_slug = 'energy-assessment-report' AND ha_is_deleted = false
     -- Sentences only the superseded draft carried. Checking for the words
     -- "deliverables" or "acknowledgment" alone would match this very article,
     -- which says the report carries neither.
     AND (ha_body_markdown ILIKE '%every section of the work plan%'
       OR ha_body_markdown ILIKE '%prints an em dash rather than disappearing%'
       OR ha_body_markdown ILIKE '%## Changing the template%');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'HA-00187 still describes removed sections';
  END IF;
  RAISE NOTICE 'HA-00187 rewritten to match the shipped report.';
END $$;
