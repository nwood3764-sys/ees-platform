-- Help article for the Energy Assessment Report — the audit's own deliverable,
-- generated from the assessment work order (not a program submittal).
INSERT INTO public.help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published, ha_created_by)
SELECT
  gen_random_uuid(), 'HA-00187', 'energy-assessment-report',
  'Producing the Energy Assessment Report',
  'Where to generate the assessment report for a Multifamily Energy Assessment work order, how the photos you flag get into it, and how to change the template.',
$md$
## Where it lives

Open the **Multifamily Energy Assessment work order** and choose **Actions → Generate Energy Assessment Report**.

It is on the work order, not the project, because the report *is* the audit's write-up: everything in it was captured on that work order. The two actions on the **project** — Generate Project Reservation Submittal and Generate Final Project Payment Request Submittal — are a different thing entirely. Those are filings to a program administering body at a stage of that program's incentive application. An assessment report is a deliverable, not a filing.

## What goes in it

**Every section of the work plan.** Each captured section prints as its own part of the report, with every question the assessor was asked and the answer recorded. A question that was left blank prints an em dash rather than disappearing — in an audit report, "asked and not answered" has to stay visible. A section marked Not Applicable prints as such, with its reason.

**The photos you flagged.** Only photos marked **Include in final report** are printed. You set that on the work order's **Photos** card: hover a photo and click the check, or select several and mark them together. Photos print with the section that captured them, so the Heating Systems photos sit under Heating Systems.

Before you generate, the dialog states how many sections were captured and how many of the work order's photos are flagged, so you can go back and flag more if the count looks wrong.

**Building context.** Year built, unit count, square footage, construction and system types come from the building and property records. Columns with no value are left out of that summary table.

## Generating it

Press **Generate Report**. Photos are fetched and prepared first (the dialog counts them off), then the PDF is built. You can then:

- **Preview** — opens it in a new tab.
- **Download** — saves it locally.
- **Save to Work Order** — files it on the work order's Documents card, where anyone with access to the work order can find it.

Generate it as many times as you like; each run reads the current state of the assessment.

## Changing the template

The report's sections, their order, and their headings are a **template**, not code. Open **SDT-00006 Multifamily Building Energy Assessment Report** and choose **Edit Sections**.

You can reorder sections by dragging, rename any heading, edit the narrative wording, change how many photos sit in a row, and add or remove sections. A **Captured Section** names one work plan section by its exact name (for example `Heating Systems`) and prints it; renaming its heading changes only what appears in the report, not the work order.

This is what lets the report be laid out to match another report you file alongside it — set the headings and the order to mirror it, and the two read side by side.

If a program needs different wording, use **Clone Template** and scope the copy to that program's opportunity record type. The scoped copy is used for that program; every other program keeps the default.

## What the report does not do

It does not model energy savings, cost, or payback. Those come out of the modelling tools; the report states the measures and the observations that back them.
$md$,
  'Field Operations', 'internal', true,
  (SELECT id FROM public.users
    WHERE user_is_deleted IS NOT TRUE
    ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles WHERE ha_slug = 'energy-assessment-report' AND ha_is_deleted = false);
