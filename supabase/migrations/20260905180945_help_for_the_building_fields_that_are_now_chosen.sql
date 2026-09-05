-- ===========================================================================
-- HA-00215 — the building fields that are now chosen for you.
--
-- Anchored to the buildings OBJECT, not merely written: the help panel surfaces
-- an article by anchor (useCurrentPageAnchors emits {type:'object', object}),
-- and an article with no anchor is reachable only by knowing to search for it
-- -- the gap HA-00208 and HA-00154 had on 2026-09-03.
-- ===========================================================================
insert into public.help_articles
  (ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience,
   ha_is_published, ha_body_markdown)
values (
  'HA-00215',
  'building-type-stories-and-year-built',
  'Building Type, Stories and Year Built',
  'Type fills itself in on a multifamily building, and Stories and Year Built are chosen from a list instead of typed.',
  'Records', 'all', true,
$md$
## Type fills itself in

A building created under either **multifamily** record type — *Multifamily* or
*New Construction Multifamily* — starts with **Type = Apartment**. You can change
it, on the new-building pop-up or on the record afterwards, and once you have
changed it nothing changes it back.

This happens **on create only**. Clearing Type on an existing building leaves it
blank; it is not refilled.

It applies however the building was created — the New Building pop-up, LEAP Pad's
ad hoc property flow, and the bulk property import all get the same default,
because the rule lives in the database rather than in one screen.

Single Family, Non-Residential, General and the New Construction Single Family /
Commercial record types are untouched: they get no default and Type stays blank
until somebody picks one.

### Changing it, or adding one for another record type

The defaults live in **Record Type Field Defaults** (`record_type_field_defaults`),
one row per object + field + record type. A row says "a new record of THIS record
type starts with THIS value". It does **not** limit what you can choose — the
Type dropdown still offers every active building type on every record type.
Adding or changing a row is an Admin database change today; there is no Setup
screen for it yet.

## Stories and Year Built are chosen, not typed

Both were free-entry number boxes with a spinner, which accepted `19855`, a
negative, or a stray decimal. They are dropdowns now.

- **Stories of Building** — 1 through 50.
- **Year Built** — 1800 through next year, newest first. Next year, not this
  year, because a New Construction building can legitimately be finishing in the
  year ahead.

The year list is worked out from today's date every time it is drawn, so it never
needs updating in January.

### The value is still a number

Nothing about the stored data changed. Year Built is still an integer and Stories
is still numeric, so both still sort, still filter as ranges ("built before
1980"), and still read correctly in the Energy Assessment Report and the bulk
property import. Only the control changed.

One visible side effect: Year Built used to print with a thousands separator —
**1,987**. It now reads **1987**.

### If the answer is not in the list

A value already stored on a building is always shown even when it falls outside
the range — a building recorded as built in 1780 keeps its year, and saving the
record will not quietly clear it.

If you need to enter a value the list does not reach, the bounds are one Admin
data edit in **Field Metadata** (`field_metadata.fm_choice_range`) — not a code
change. Tell an administrator the number you need rather than working around it.

## Two "Stories" columns

`buildings` carries both `building_stories` and `building_stories_of_building`.
The one on the page, and the one every report and the assessment report read, is
**Stories of Building**. `building_stories` is on no page layout and holds no
data on any building; it is a leftover and should not be used.
$md$
)
-- the slug index is PARTIAL (live rows only), so the conflict target has to
-- carry the same predicate or Postgres cannot match it.
on conflict (ha_slug) where (ha_is_deleted = false) do update set
  ha_title = excluded.ha_title,
  ha_summary = excluded.ha_summary,
  ha_body_markdown = excluded.ha_body_markdown,
  ha_category = excluded.ha_category,
  ha_is_published = true,
  ha_updated_at = now();

-- help_article_anchors carries no unique constraint, so the guard is explicit:
-- a re-run must not stack a second identical anchor.
insert into public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order)
select a.id, 'object', 'buildings', 10
  from public.help_articles a
 where a.ha_slug = 'building-type-stories-and-year-built'
   and not exists (
     select 1 from public.help_article_anchors x
      where x.haa_article_id = a.id and x.haa_anchor_type = 'object' and x.haa_object = 'buildings');

do $$
DECLARE v_id uuid; v_n int;
BEGIN
  SELECT id INTO v_id FROM public.help_articles WHERE ha_slug='building-type-stories-and-year-built';
  IF v_id IS NULL THEN RAISE EXCEPTION 'HA-00215 was not created'; END IF;
  -- Writing the article is not indexing it: without an anchor the ? button on a
  -- building has nothing to say about the fields on the screen.
  SELECT count(*) INTO v_n FROM public.help_article_anchors
   WHERE haa_article_id = v_id AND haa_anchor_type='object' AND haa_object='buildings';
  IF v_n < 1 THEN RAISE EXCEPTION 'HA-00215 is not anchored to buildings'; END IF;
END $$;
