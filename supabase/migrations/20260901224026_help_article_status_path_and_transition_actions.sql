-- Help article for the status path, and a correction to HA-00053.
--
-- The path shipped without an article of its own — HA-00147 covers the
-- opportunity stage chevron only — so nothing described the strip a user sees
-- on an incentive application, a project, an enrollment or a work order, and
-- nothing said where the object name in each chevron had gone.
--
-- HA-00053 is corrected in place rather than appended to. Two of its claims
-- are now wrong: the transitions bar is no longer always its own card at the
-- top of the page (where a status path renders the same field, the buttons are
-- inside the path), and its "phase 2" resolver — author a row in
-- object_lifecycle_config to pick a primary status field on a table that has
-- two — was never implemented. An admin following that instruction would have
-- authored a row nothing reads.

INSERT INTO public.help_articles
  (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
   ha_category, ha_audience, ha_is_published, ha_created_by, ha_updated_by)
SELECT '', 'status-path-chevrons',
  'The status path: reading a record''s lifecycle',
  'The chevron strip at the top of a record shows every stage of its lifecycle, where the record stands, and the moves permitted from here.',
$md$
# The status path

Records that have a lifecycle — incentive applications, enrollments, projects,
work orders, payment requests, opportunities — open with a **status path**: a
strip of chevrons showing every stage the record can be in, in order.

- **Filled dark green** — stages already behind this record.
- **Bright green, bold** — where the record stands right now.
- **Outlined** — stages still ahead.

Under the strip the current stage is spelled out in full, followed by any
guidance authored for the move out of it, and then the **Move to** buttons —
the transitions the lifecycle actually permits from here. There is one card,
not two: the path and the actions belong together.

## Why a chevron does not repeat the object's name

LEAP names every status `[Object] [State]` — *Incentive Application To Be
Prepared*, *Incentive Application Pre-Approved*, and so on. Repeating
"Incentive Application" in all nine chevrons leaves almost no room for the part
that differs, so the strip drops the words **every stage on that path shares**
and each chevron carries only what makes it different: *To Be Prepared*,
*Pre-Approved*, *Corrections Needed*.

This is worked out from the stages themselves, not configured per object. A set
with nothing in common — work order statuses are *New*, *Scheduled*,
*In Progress* — is shown exactly as authored. The full name is always available:
hover a chevron for its tooltip, and the current stage is printed in full under
the strip.

## When a stage list is long

The strip wraps onto as many rows as it needs, and each chevron is sized to its
own label. A nine-stage lifecycle reads as nine legible stages rather than nine
slivers, on a desktop and on a phone alike. A very long list (project status
carries 36 values) produces a taller block — that is the lifecycle being long,
and the honest thing to show.

## Which stages appear

Every active value of the record's status field that applies to **its record
type**, in the order authored. Stages are scoped in **Setup → Picklists**: a
value assigned to specific record types shows only on those, and a value with
no assignments shows everywhere. Turning off *Show in path* on a value keeps it
selectable while hiding it from the strip.

Off-path outcomes — *Corrections Needed*, *Denied*, *Withdrawn* — are shown in
their authored position, not hidden. The strip is the full set of states a
record can reach, not a happy path.

## The chevrons are a read-out, not a control

Clicking a chevron does nothing. The record moves through the **Move to**
buttons underneath, and only along transitions authored in
**Setup → Lifecycle Builder**; each one is validated server-side before it is
applied (see HA-00053). A chevron that could be clicked but that the server
would refuse is not a control.

## Putting the path on a page layout

The path is a **Status Path** card on the page layout, configured with the
status column it should render (`ia_status`, `project_status`,
`work_order_status`, …). A layout can carry more than one — a work order has
both a work status and an approval status — and each renders its own strip and
its own actions.

If a record shows no path at all, the layout has no Status Path card, or the
record's record type has no stages assigned for that field.

## Related

- **The status transitions bar** (HA-00053) — what happens when a Move to
  button is pressed
- **Setup → Lifecycle Builder** (HA-00052) — where the transitions are authored
- **Scoping picklist values to record types** (HA-00079)
- **Opportunity Stage Path** (HA-00147) — the opportunity's own stage ladder
$md$,
  'Records', 'all', true, u.id, u.id
FROM (SELECT id FROM public.users WHERE id='c5a01ec8-960f-42ab-8a9e-a49822de89af') u
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles
   WHERE ha_slug = 'status-path-chevrons' AND ha_is_deleted IS NOT TRUE);

-- ── HA-00053 corrected in place ──────────────────────────────────────────
UPDATE public.help_articles SET
  ha_summary = 'One button per permitted move out of the record''s current status. Pressing one confirms the change and calls change_record_status, which re-validates the move against the lifecycle before applying it.',
  ha_body_markdown = replace(
    ha_body_markdown,
    'On any record whose object has a configured lifecycle in **Setup → Lifecycle Builder**, a status transitions bar appears at the top of the record detail page, just below the header and above the tab bar.',
    'On any record whose object has a configured lifecycle in **Setup → Lifecycle Builder**, the moves permitted out of the current status appear as buttons near the top of the record detail page.

**Where they appear depends on the page layout.** If the layout carries a
**Status Path** card for that status field ("The status path: reading a
record's lifecycle"), the buttons are the
*Move to* row inside the path card, under the chevrons — one card announcing
one status. If it does not, they appear in a bar of their own, just below the
header and above the tab bar, led by the current status as a monospace pill.'),
  ha_updated_at = now()
WHERE ha_record_number = 'HA-00053' AND ha_is_deleted IS NOT TRUE;

-- The phase-2 resolver the article promised does not exist in the platform.
UPDATE public.help_articles SET
  ha_body_markdown = regexp_replace(
    ha_body_markdown,
    '### How the bar resolves which status field to follow.*?### When the bar is hidden',
    '### How the bar resolves which status field to follow

A **Status Path** card names its status field outright, so its *Move to* row
follows that field with no guessing — which is how a table with two lifecycles
(a work order has both a work status and an approval status) gets a control for
each: give the layout a Status Path card per field.

A standalone bar has no such declaration, so it asks `status_transitions` which
columns on the object have transitions authored:

- **Zero columns**: the object has no lifecycle configured. The bar stays hidden.
- **One column**: unambiguous. That is the lifecycle field.
- **More than one column**: ambiguous, and the bar suppresses rather than
  guessing. Put a Status Path card on the layout for the field you want
  surfaced. (`object_lifecycle_config` exists in the schema and is read by the
  Flow Builder, but nothing in the record page consults it — a row authored
  there will not bring the bar back.)

### When the bar is hidden',
    'n'),
  ha_updated_at = now()
WHERE ha_record_number = 'HA-00053' AND ha_is_deleted IS NOT TRUE;

UPDATE public.help_articles SET
  ha_body_markdown = replace(
    ha_body_markdown,
    '2. **The table has multiple status fields and no primary is declared** — `status_transitions` has rows on more than one column AND `object_lifecycle_config` has no matching row for the object. Author a row in `object_lifecycle_config` to resolve.',
    '2. **The table has multiple status fields** — `status_transitions` has rows on more than one column, so a standalone bar cannot tell which lifecycle to drive. Add a Status Path card to the page layout for the field you want.
2b. **A Status Path card on the layout already covers the field** — the path renders these same buttons in its own card, and two cards announcing one status read as a defect.'),
  ha_updated_at = now()
WHERE ha_record_number = 'HA-00053' AND ha_is_deleted IS NOT TRUE;

DO $$
DECLARE n text; body text;
BEGIN
  SELECT ha_record_number INTO n FROM public.help_articles
   WHERE ha_slug = 'status-path-chevrons' AND ha_is_deleted IS NOT TRUE;
  IF n IS NULL OR n NOT LIKE 'HA-%' THEN
    RAISE EXCEPTION 'help article not created, or its record number is malformed: %', n;
  END IF;
  RAISE NOTICE 'help article %', n;

  -- The correction has to have LANDED, not merely been attempted: a replace()
  -- whose search text has drifted silently leaves the wrong instruction in place.
  SELECT ha_body_markdown INTO body FROM public.help_articles
   WHERE ha_record_number = 'HA-00053' AND ha_is_deleted IS NOT TRUE;
  IF body IS NULL THEN
    RAISE EXCEPTION 'HA-00053 not found — it is the article this change corrects';
  END IF;
  IF body LIKE '%Author a row in `object_lifecycle_config` to resolve%' THEN
    RAISE EXCEPTION 'HA-00053 still tells admins to author an object_lifecycle_config row, which nothing reads';
  END IF;
  IF body NOT LIKE '%Status Path%' THEN
    RAISE EXCEPTION 'HA-00053 was not corrected: it still does not mention the status path card';
  END IF;
END $$;
