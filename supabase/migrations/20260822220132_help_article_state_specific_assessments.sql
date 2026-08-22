-- HA-00175 — Assessment record types by state, and the work order that comes with them.
--
-- Covers the three changes shipped 2026-08-22: state-specific assessment record
-- types and layouts, the opportunity record type deciding which assessment types
-- are available (and the Setup pane for changing that), and the work order that
-- is now created automatically with every assessment.

INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience,
  ha_is_published, ha_is_deleted, ha_body_markdown, ha_created_by
)
SELECT
  '', 'state-specific-assessment-record-types',
  'Assessment record types by state, and the work order that comes with them',
  'Every state runs its own IRA assessment record type, page layout, work type and work plan. The opportunity decides which assessment types you can pick, and creating an assessment now creates its work order automatically.',
  'Records', 'internal', true, false,
$md$
## The short version

Each state runs its own programs, so each state has its own **assessment record types**, its own **page layouts**, and its own **work types and work plans**. Nothing is shared between states.

When you create an assessment:

1. It takes its record type from the **opportunity's program**, so you do not have to know which one to pick.
2. It gets that state's page layout.
3. Its **work order is created automatically**, already carrying that state's work plan and all its steps.

## Which assessment types you can pick

The opportunity decides. A `NC-IRA-MF-HOMES-AUDIT` opportunity offers the North Carolina multifamily assessment type — never Wisconsin's or Michigan's.

| Opportunity record type | Assessment record types available |
|---|---|
| WI-IRA-MF-HOMES-AUDIT | ASHRAE Level 1, ASHRAE Level 2, WI-IRA-MF-HOMES-AUDIT |
| WI-IRA-SF-HOMES-AUDIT | ASHRAE Level 1, ASHRAE Level 2, WI-IRA-SF-HOMES-AUDIT |
| NC-IRA-MF-HOMES-AUDIT | ASHRAE Level 1, ASHRAE Level 2, NC-IRA-MF-HOMES-AUDIT |
| NC-IRA-SF-HOMES-AUDIT | ASHRAE Level 1, ASHRAE Level 2, NC-IRA-SF-HOMES-AUDIT |
| MI-IRA-MF-HOMES-AUDIT | ASHRAE Level 1, ASHRAE Level 2, MI-IRA-MF-HOMES-AUDIT |
| MI-IRA-SF-HOMES-AUDIT | ASHRAE Level 1, ASHRAE Level 2, MI-IRA-SF-HOMES-AUDIT |

Opportunity record types that have not been configured are unrestricted — every assessment record type stays available on them. Only the programs listed above are limited.

If you somehow pick a type the opportunity does not allow, the save is refused with a message naming what **is** allowed. That check lives in the database, so it holds for imports and automations too, not just the form.

## Changing what a program allows

**Setup → Object Manager → Opportunity → Record Types**, then **Assessment types** on the program's row.

Tick the assessment record types that program should offer. Two things to know:

- Ticking **none** (or **all**) leaves the program open — every assessment record type stays available, including any added later. That is usually what you want for a program still being set up.
- Unticking a type does not touch assessments that already carry it. It only stops new ones.

## The work order

Every assessment record type declares which **work type** its assessments produce, set in **Setup → Object Manager → Assessment → Record Types**. When you save a new assessment, LEAP creates the work order for you, and the work plan and all its steps are built from that work type's template — the same 15-step multifamily plan or 17-step single-family plan the crew already uses, in that state's own copy.

Nothing is created if:

- the record type has no work type set (most non-field programs),
- the assessment has no opportunity, project or property — a work order cannot exist without all three, or
- the assessment already has a work order.

In those cases the assessment still saves normally; you can add a work order by hand from the Work Orders card.

## Why an assessment sometimes has no record type prompt

If the opportunity's program allows exactly one assessment record type, LEAP picks it and skips the prompt. You will see the choice only when there is a genuine choice to make.
$md$,
  (SELECT id FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles WHERE ha_slug = 'state-specific-assessment-record-types'
);
