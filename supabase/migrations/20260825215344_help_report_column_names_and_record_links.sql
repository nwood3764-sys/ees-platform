-- ============================================================================
-- HA-00191 — Report columns: what each header says, and clicking through
-- ----------------------------------------------------------------------------
-- Nicholas, 2026-08-25, from RPT-00041 "Lutheran Social Services
-- Opportunities": three columns in a row headed "NAME", and only the first
-- column of the report was clickable. Both are fixed in the app; this is the
-- article that says what the headers now mean and which cells open a record.
--
-- Data only — no schema change. The headers are derived when a report runs,
-- so nothing stored has to be rewritten for an existing report to read right.
-- ============================================================================

insert into help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
   ha_category, ha_audience, ha_is_published)
select gen_random_uuid(), 'HA-00191', 'report-column-names-and-record-links',
 'Report Columns: What Each Header Says, and Clicking Through to a Record',
 'Every report column is named for the object it comes from, no two headers in one report are the same, and every cell that is a record opens that record.',
$md$## Column headers name their object

A report column is headed with the field **and the object it belongs to**, so a
report that lists a property, its building and the opportunity reads:

| Property Name | Building Name | Opportunity Name | Stage | Amount |
|---|---|---|---|---|

Three rules produce that:

- **A field from a related object is named for the relationship it came
  through.** The property's name is *Property Name*; the building's is
  *Building Name*. When an object is reached two different ways, each reads
  differently — a property's *Account Name* and its *Management Company Name*
  are both the name of an account, and the header says which.
- **A record's own name or record number carries its object**, even on the
  report's own object: *Opportunity Name*, never a bare *Name*.
- **Everything else keeps the short label.** A report on opportunities says
  *Stage* and *Amount*; a report on properties says *City*, not *Property
  City*. The object is only added where it is needed to tell columns apart.

If two columns would still read the same, the header widens until they don't,
and identical columns are numbered — **no two columns in one report ever share
a header**.

## Headers you wrote yourself are kept

If a column was given a header by hand — *ZIP Code*, *HUD Property ID*,
*Street Address* — that wording is left exactly as it is. Only headers that
LEAP derived are re-derived, which is what corrects reports built before this
without touching anyone's wording.

Nothing has to be re-saved: headers are worked out when the report runs, so an
old report reads correctly the next time you open it, in the viewer and in the
CSV, Excel and PDF exports alike.

## Every cell that is a record opens it

Three kinds of cell are links, in the report viewer and in a report tile on a
dashboard:

- **The record the row is about** — the first column, and the object's own name
  or record number wherever it sits in the report.
- **A lookup column** — the *Property* or *Account* column on the row opens
  that property or account.
- **A related object's name or record number** — the *Property Name* and
  *Building Name* columns open the property and the building, not the
  opportunity the row is about.

They are real links: click to open, middle-click or ⌘/Ctrl-click for a new tab,
right-click to copy the address. A value that is not a record — a stage, an
amount, a city — stays plain text, and a reference that is empty on a row stays
plain text on that row.

## Picking fields in the builder

The field, filter and grouping pickers open **over** the page rather than
inside the card, so a long list is scrollable to the last field instead of
being cut off at the card's edge. A picker near the bottom of the window opens
upward. Click outside it, or press Escape, to close it.
$md$,
 'Reports & Dashboards', 'internal', true
where not exists (
  select 1 from help_articles
   where ha_record_number = 'HA-00191' and ha_is_deleted is not true
);
