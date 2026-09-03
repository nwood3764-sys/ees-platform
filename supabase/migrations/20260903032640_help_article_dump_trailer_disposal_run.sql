-- Help for the Dump Trailer Disposal Run, and it is ANCHORED, not merely
-- written: the ? button surfaces articles by the object on screen, so an
-- article with no anchor is reachable only by knowing to search for it.

WITH new_article AS (
  INSERT INTO public.help_articles
    (ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience,
     ha_is_published, ha_created_by, ha_body_markdown)
  VALUES (
    '', 'dump-trailer-disposal-run', 'Dump Trailer Disposal Run',
    'Taking a loaded dump trailer to a landfill or transfer station: what to photograph before you leave the site, at the facility, and at the scale house.',
    'Field Service', 'internal', true, 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
$md$# Dump Trailer Disposal Run

A **Dump Trailer Disposal Run** is the work order for hauling a loaded dump trailer off a job site to a landfill or transfer station, emptying it, and paying for it. It records three things nobody can reconstruct afterwards: **what was in the trailer**, **that it left the site safely**, and **what the disposal cost**.

Disposal is a project cost and the tonnage is a programme figure, so this work order is created **from the job whose debris it is** — not as a stand-alone errand.

## Creating one

In LEAP Pad, open the stop you are on and choose **Create Work Order → Dump Trailer Disposal Run**. It inherits the property, building, unit and project from that stop, lands on your own day, and opens with its three steps ready.

If you are not standing on one of your stops, use **Property is not in this list** and pick the property, building, unit and project yourself.

## The three steps, in order

The plan is ordered, because the three steps happen in three places. Each one is a guided screen — press **Start** and it walks you through the prompts one at a time.

### 1. Loaded Trailer Ready to Leave the Site

Before the truck moves.

| Prompt | What it is |
| --- | --- |
| Dump Trailer | Which trailer you are hauling, picked from the fleet. |
| Load in the Trailer — Untarped | Tarp off, from the back or the side, whole load visible. |
| Back Gate Locked | Close up on the gate closed, latched and pinned. |
| Trailer Connected to the Truck | Coupler down and latched, safety chains crossed, breakaway cable and light cord plugged in — one frame. |
| Load Tarped for the Road | The tarp over the load and tied down. |

### 2. Load Dumped at the Disposal Facility

At the landfill or transfer station.

| Prompt | What it is |
| --- | --- |
| Landfill or Transfer Station | The facility's name, as it reads on the ticket. |
| Trailer Empty at the Landfill | Inside the empty trailer, bed raised or gate open, taken at the facility. |

### 3. Disposal Receipt and Cost

At the scale house, after paying.

| Prompt | What it is |
| --- | --- |
| Paid Receipt or Scale Ticket | The whole ticket — facility, date, weight and amount all readable. |
| Net Weight Dumped | The net weight in tons from the ticket. |
| Amount Paid | The total charged. |
| Paid With | Company Credit Card, Fuel Card, Cash, Billed to the Company Account, or Prepaid Account. |

## What you can and cannot skip

**Net Weight Dumped is the only prompt you may leave blank.** Plenty of construction and demolition facilities price by the cubic yard and never put a weight on the ticket, and you should not be stuck in a queue over a number that does not exist. Everything else happens on every run, so a step will not complete until it is answered — it tells you by name what is missing.

If something genuinely cannot be photographed, mark the **step** Not Applicable and give the reason. Never close a step with a substitute photograph: the record is worth less than nothing if it shows something other than what it claims.

## The trailer

The **Dump Trailer** prompt is a picker over real fleet records, and choosing it stamps the trailer onto the work order — so "every run this trailer made" is a real join, and the trailer carries its own history alongside its maintenance.

If your trailer is not in the list, an admin adds it in **LEAP Admin → Fleet** with the record type **Trailer**. Until the trailers are entered the prompt can be left blank; everything else on the run still works.

## Verification

Every step is owned by a **Lead Technician** and verified by a **Project Site Lead** — the second set of eyes LEAP requires before any step closes. The photographs and the ticket are what the verifier is looking at.

## There is no appointment

A dump run does not visit a customer, so it books no service appointment and sends nobody a notification. It reaches you the way all non-assessment work does: the work order names you as its **Assigned Technician** and carries its own **Scheduled Start Date**, and that is what puts it on your day.
$md$
  ) RETURNING id
)
INSERT INTO public.help_article_anchors
  (haa_article_id, haa_anchor_type, haa_object, haa_concept, haa_sort_order, haa_created_by)
SELECT new_article.id, a.atype, a.obj, a.concept, a.ord, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM new_article, (VALUES
  ('object', 'work_orders',   NULL::text,             1),
  ('object', 'work_steps',    NULL,                   2),
  ('object', 'vehicles',      NULL,                   3),
  ('concept', NULL,           'dump-trailer-disposal', 4)
) AS a(atype, obj, concept, ord);

DO $$
DECLARE v_id uuid; v_n integer;
BEGIN
  SELECT id INTO v_id FROM public.help_articles
   WHERE ha_slug = 'dump-trailer-disposal-run' AND ha_is_deleted IS NOT TRUE;
  IF v_id IS NULL THEN RAISE EXCEPTION 'The Dump Trailer Disposal Run article was not created.'; END IF;

  SELECT count(*) INTO v_n FROM public.help_article_anchors WHERE haa_article_id = v_id;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'The article has % anchors — with none it is reachable only by searching for it.', v_n;
  END IF;

  -- Findable by the questions a driver actually asks.
  IF NOT EXISTS (
    SELECT 1 FROM public.help_articles
     WHERE ha_is_deleted IS NOT TRUE AND ha_is_published IS TRUE
       AND ha_search @@ websearch_to_tsquery('english', 'dump trailer landfill')
  ) THEN
    RAISE EXCEPTION 'Searching "dump trailer landfill" finds nothing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.help_articles
     WHERE ha_is_deleted IS NOT TRUE AND ha_is_published IS TRUE
       AND ha_search @@ websearch_to_tsquery('english', 'disposal receipt')
  ) THEN
    RAISE EXCEPTION 'Searching "disposal receipt" finds nothing.';
  END IF;

  -- The category is the one the Field Service heading already groups under;
  -- a second spelling would split the table of contents in two.
  IF NOT EXISTS (
    SELECT 1 FROM public.help_articles
     WHERE id = v_id AND ha_category = 'Field Service'
  ) THEN
    RAISE EXCEPTION 'The article is filed outside Field Service, where every other work-order article lives.';
  END IF;
END $$;
