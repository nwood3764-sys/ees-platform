-- Help: reading a Manual J onto an assessment, and choosing the design load.
--
-- Anchored to the objects it is about, not merely written: an article with no
-- anchors is reachable only by knowing to search for it (the 2026-09-03 lesson
-- that writing an article is not indexing it).

WITH new_article AS (
  INSERT INTO public.help_articles
    (ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience,
     ha_is_published, ha_created_by, ha_body_markdown)
  VALUES (
    '', 'manual-j-load-calculation', 'Manual J Load Calculation',
    'Drop a Conduit Tech Manual J report onto an assessment: what LEAP reads off it, why the printed Whole Home load is often the wrong number to size to, and how the design load is chosen.',
    'Programs', 'internal', true, 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
$md$# Manual J Load Calculation

A **Manual J** is the room-by-room heating and cooling load calculation for a building. It is the number equipment gets sized to, and until now LEAP had nowhere to put one — the report lived as a PDF and the loads were retyped into whatever needed them.

The **Manual J Load Calculation** card on an assessment reads the report instead. Drop the PDF on it and LEAP pulls out the design conditions, every load table and the building assemblies, shows you what it found, and files the PDF on the assessment as the evidence.

## Filing one

Open the assessment, find **Manual J Load Calculation** on the Related tab, and drag the Conduit Tech report onto it (or press **Choose a PDF**).

Nothing is saved yet. LEAP shows you everything it read so you can check it, because a load calculation nobody verified is a number somebody typed.

## Choosing the design load — read this part

**A Manual J prints several loads, and the biggest one is often the wrong one to size to.**

When a report models more than one proposed system — say a gas furnace *and* a cold climate heat pump for the same house — the **Whole Home** page adds up each system's assignment separately. Any room served by both systems is counted **twice**.

On a real report for a Madison duplex the Whole Home page prints **46,735 Btu/h** of heating load. The building actually needs **29,882**. The other 16,853 is the same five rooms over again. Size a heat pump to the printed figure and it is nearly twice the house — it short-cycles, it costs more, and it will not pass a programme inspection.

So the card offers the loads it can defend and says where each one came from:

| Choice | What it means |
|---|---|
| **Whole building** | The Whole Home page with the double-counted rooms removed. This is the recommended one, and on a single-system report it is simply the Whole Home total. |
| **Whole Home, exactly as printed** | The report's own figure, offered unchanged and flagged when it counts shared rooms twice. |
| **All rooms, de-duplicated** | Every distinct room added up. Excludes anything the report only counts at system level — usually blower heat. |
| **Each proposed system** | Only the part of the building that system serves. Use this when you are sizing equipment for one zone rather than the whole building. |

Pick one. The **basis** you picked is saved next to the number, so nobody has to work out later what "29,882" referred to.

## What LEAP reads

- **Design conditions** — weather station, winter and summer design temperatures, indoor conditions, elevation, altitude correction factor. The winter outdoor temperature is the condition cold-climate capacity is rated against, so it matters more than any other single figure here.
- **Every load table** — whole home, each proposed system, each zone, each room, and any room no system serves (a basement, a stairwell). Each keeps its full component breakdown: walls, glazing, ceilings, floors, ducts, infiltration, blower heat and the rest.
- **Duct configuration** — distribution type, supply run location, leakage class, duct insulation, airway configuration.
- **Building assemblies** — every wall, floor, ceiling, door and window construction with its area and U-value, and the description that carries the R-values.

Everything is stored **exactly as the report printed it**, including the Whole Home total that double counts. LEAP flags it rather than quietly correcting the source, because a corrected number with no note becomes a fact nobody can question later.

## The one field that is not on the report

The **home construction year** is not part of a Manual J. LEAP fills it from the assessment, then the building, then the property — and if none of them holds one, it leaves the field empty and asks you. It is used to bracket equipment search results, so a guessed year is worse than a blank one.

## Feeding equipment selection

These are the fields the NEEP Cold Climate Air Source Heat Pump List asks for — ZIP code, weather station, heating and cooling design temperatures, heating and cooling design loads, building square footage and construction year. Once a Manual J is filed, all of them are answered from the report except the construction year.

The card tells you which are still missing. You can save without them; the load calculation is worth having either way.

## Revisions

Each upload is filed as its own record. A revised Manual J is a new report — the source report carries its own "Last Updated" date, and keeping both means the load a proposal was priced on is still there after the calculation is redone.

**Remove** takes a report off the assessment into the recycle bin. Nothing in LEAP is hard-deleted.

## If the drop does nothing

- The card only accepts a **PDF**. A scanned image of a report has no text in it to read.
- If LEAP says it found no load tables, check the file is the Manual J report and not the proposal, the invoice or the floor plans.
- The report's own font drops a couple of letter pairs when it is read — an email address may come through as `energyeciencyservices.org`. That is the PDF, not LEAP, and it only ever affects text that is copied through for reference.

## Who can see it

Whoever can see the assessment. If your access is limited to particular states, a Manual J is visible on the same assessments you can already open.
$md$
  ) RETURNING id
)
INSERT INTO public.help_article_anchors
  (haa_article_id, haa_anchor_type, haa_object, haa_concept, haa_sort_order, haa_created_by)
SELECT new_article.id, a.atype, a.obj, a.concept, a.ord, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM new_article, (VALUES
  ('object',  'assessments',        NULL::text,          1),
  ('object',  'manual_j_reports',   NULL,                2),
  ('object',  'buildings',          NULL,                3),
  ('concept', NULL,                 'manual-j',          4),
  ('concept', NULL,                 'equipment-selection', 5)
) AS a(atype, obj, concept, ord);

DO $$
DECLARE v_id uuid; v_n integer;
BEGIN
  SELECT id INTO v_id FROM public.help_articles
   WHERE ha_slug = 'manual-j-load-calculation' AND ha_is_deleted IS NOT TRUE;
  IF v_id IS NULL THEN RAISE EXCEPTION 'The Manual J article was not created.'; END IF;

  SELECT count(*) INTO v_n FROM public.help_article_anchors WHERE haa_article_id = v_id;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'The article has % anchors — with none it is reachable only by searching for it.', v_n;
  END IF;

  -- It must come back for the questions somebody actually asks, and it must be
  -- behind the ? button on an assessment, which is the screen it is about.
  IF NOT EXISTS (
    SELECT 1 FROM public.help_article_anchors
    WHERE haa_article_id = v_id AND haa_anchor_type = 'object' AND haa_object = 'assessments') THEN
    RAISE EXCEPTION 'The article is not anchored to assessments — pressing ? on the screen it describes would not find it.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.help_articles
    WHERE ha_is_deleted IS NOT TRUE AND ha_is_published
      AND ha_search @@ websearch_to_tsquery('english', 'manual j design load')) THEN
    RAISE EXCEPTION 'Searching for "manual j design load" returns nothing.';
  END IF;
END $$;
