-- Help article: capturing an assessment in the field or at a desk.
INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published
) VALUES (
  '', 'capturing-an-assessment',
  'Capturing an Assessment: Any Order, Drag-and-Drop, and the Completion Gate',
  'Assessment sections can be taken in any order, photos can be dragged in from a folder on a desktop, and a progress bar shows exactly what is left before the work order can be submitted.',
$md$
# Capturing an Assessment

## Take the sections in any order

An energy assessment work order is a list of sections — Building Photos, Roof / Ceiling, Walls, Heating Systems, and so on. **Every section is open from the moment the work order starts.** Do the roof while the hatch is open, come back to the boiler room when the super arrives, and finish the exterior photos last.

Order is not what makes an assessment complete — captured evidence is. Each section still refuses to close until its own required photos, measurements and answers are recorded, so nothing can be skipped by jumping around.

(Installation work plans still run in order. Whether a work plan allows any order is set on the work plan template, not in code.)

## The progress bar

Two bars, answering two different questions.

**On the work order** — how many sections are captured, out of all of them. Sections marked *Not Applicable* count as settled, because that is a decision, not a gap. The bar reaches 100% exactly when the work order can be submitted.

**Inside a section** — how much of that section is captured. It measures recorded answers and photos, not which prompt you are standing on, so stepping back through a finished section does not push it backwards.

## Adding photos

Three ways, all landing in the same place with the same watermark, EXIF and GPS handling:

- **Take Photo** — opens the camera. This is the normal path in the field.
- **The folder button** — opens your files. **You can select several photos at once.**
- **Drag and drop** — on a desktop, drag photos from a folder straight onto the prompt. A green panel appears while you drag; drop and they upload.

While photos upload you see a green banner counting them ("Uploading photo 4 of 12…") and a placeholder tile for each one still in flight. Wait for it to finish before leaving the section — the count tells you exactly where it is.

Anything that is not an image (a PDF, a video, a dragged folder) is skipped, and the screen tells you how many were skipped rather than appearing to lose them.

Each thumbnail is labelled with the prompt it answers — "Front Elevation", not `mf_elev_front`.

## You cannot submit an incomplete assessment

**Submit for Verification** stays disabled until every section is complete, and the button shows how many are done. Underneath it, **Still to capture** lists the sections that are not finished and what each one is waiting for — the same wording the database uses when it refuses a submission, so what you read on screen and what the system enforces can never disagree.

If a section genuinely does not apply — there are no can lights in this attic — mark it **Not Applicable** with a reason. That closes it honestly, and the reason is kept on the record.
$md$,
  'Field Operations', 'internal', true
);
