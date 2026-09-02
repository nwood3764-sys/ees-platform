-- Help: the Service Appointments list view, and the inbox that is not it.
--
-- HA-00015 told people the inbox was "the single working surface for everything
-- customers have booked themselves plus anything dispatch has scheduled
-- manually" and, for finding appointments caught by a new absence, to "filter by
-- date range". Neither was ever true: the board has no date-range filter, it
-- only ever looked forward, and every appointment on this database is in the
-- past. Following that instruction is exactly how somebody ends up asking why
-- they cannot see a past service appointment. Corrected in place, not appended
-- to — a wrong instruction is worse than a missing one.
--
-- New article for the list view itself, and a section on HA-00084 for the
-- relative date filters that now make "before today" something a saved view can
-- say.

BEGIN;

-- ─── New: the Service Appointments list view ─────────────────────────────────
DO $$
DECLARE v_id uuid;
BEGIN
  -- No ON CONFLICT: the slug's unique index is PARTIAL (live rows only), so an
  -- ON CONFLICT (ha_slug) does not match it and the statement is rejected.
  INSERT INTO help_articles (
    ha_slug, ha_title, ha_summary, ha_category, ha_audience,
    ha_is_published, ha_is_deleted, ha_body_markdown
  )
  SELECT * FROM (VALUES (
    'service-appointments-list-view',
    'The Service Appointments list view',
    'Where every service appointment lives — past, today and upcoming — and the four saved views that get you to each.',
    'List Views', 'internal', true, false,
$md$**Field → Service Appointments** is the list view for the Service Appointment
object. Every appointment is here: finished, today's, and scheduled ahead.

If you are looking for an appointment that already happened, this is the screen.

## The four saved views

Pick one from the view selector at the top left.

| View | Shows |
|---|---|
| **All Service Appointments** | Every appointment, most recently scheduled first. This is what the tab opens on. |
| **Past Service Appointments** | Everything scheduled before today, most recent first. |
| **Today's Service Appointments** | Today only, in time order. |
| **Upcoming Service Appointments** | Today and later, in time order. |

These say what they mean on the day you read them — "before today" is resolved
when the view runs, not frozen at the moment it was saved.

An appointment with **no scheduled time** appears in All, and in neither Past nor
Upcoming. It has no date to be on either side of. Use All, or filter Scheduled
Start Time **is blank**, to find them.

## The columns

Record #, name, Status, Scheduled Start and End, Work Type, Work Order and
Record Owner. Add or remove any of them with **Columns**, and add fields from the
work order, work type, project, opportunity or contact through the same picker —
they are grouped under the object they come from.

## Filtering by date

The date filters take a relative period as well as a calendar date. Open
**Filters**, choose Scheduled Start Time, pick an operator, and the value box
offers Today, This Week, Last 30 Days, Next 90 Days and the rest — or **Fixed
date…** for a specific day. A filter written this way keeps being right
tomorrow, which is what makes it worth saving as a view.

## This is not the Appointment Inbox

The **Appointment Inbox** tab beside it is the dispatcher's board for the days
ahead: scheduled work from today forward, grouped by day, with each customer's
phone and email on the row so you can call them. It looks forward only, on
purpose. Anything that has already happened is here on the list view.

## Creating and editing

**+ New** opens the create pop-up, which asks for the fields an appointment
cannot do without — including its scheduled start and end. Double-click a cell
to edit it in place; select rows to edit several at once.
$md$
  )) AS a(slug, title, summary, category, audience, published, deleted, body)
   WHERE NOT EXISTS (
     SELECT 1 FROM help_articles
      WHERE ha_slug = 'service-appointments-list-view' AND ha_is_deleted = false
   );

  SELECT id INTO v_id FROM help_articles
   WHERE ha_slug = 'service-appointments-list-view' AND ha_is_deleted = false;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'the service appointment list view article was not created';
  END IF;

  INSERT INTO help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_concept, haa_sort_order)
  SELECT v_id, 'object', 'service_appointments', NULL, 0
   WHERE NOT EXISTS (SELECT 1 FROM help_article_anchors
                      WHERE haa_article_id = v_id AND haa_anchor_type = 'object'
                        AND haa_object = 'service_appointments');

  INSERT INTO help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_concept, haa_sort_order)
  SELECT v_id, 'concept', NULL, 'service-appointment-list-view', 1
   WHERE NOT EXISTS (SELECT 1 FROM help_article_anchors
                      WHERE haa_article_id = v_id AND haa_anchor_type = 'concept'
                        AND haa_concept = 'service-appointment-list-view');
END $$;

-- ─── Corrected: HA-00015, which described a tab that no longer exists ────────
UPDATE help_articles SET
  ha_title = 'The Appointment Inbox',
  ha_summary = 'How to use the Field → Appointment Inbox: what the board covers, status meanings, and how Out of Office and customer self-service changes flow back in.',
  ha_body_markdown =
$md$The **Appointment Inbox** is the dispatcher's board for the days ahead —
everything customers have booked themselves at `/sa` and everything dispatch has
scheduled, from the start of today forward. Live at **Field → Appointment
Inbox**.

> **It looks forward only.** The inbox cannot show an appointment that has
> already happened, whichever window you pick. For anything past — or to search,
> filter or sort across every appointment — use **Field → Service
> Appointments**, the object's list view, and its **Past Service Appointments**
> view. (This tab used to be called "Service Appointments", which is why it was
> easy to expect it to hold them all.)

## What you see

Every row is one scheduled Service Appointment, grouped by day (Chicago calendar
time). The window runs from the start of today through the next 14 days by
default; the dropdown switches to 7 / 30 / 60. A job that started this morning
stays on the board for the rest of the day.

Each row shows the time, customer name and contact, work type and location, and
the assigned technician. Click a row to open the appointment record.

## Status meanings

The board shows **Scheduled** work. The full lifecycle, in the order it
typically progresses:

- **Scheduled** — confirmed slot, technician assigned, customer notified
- **Dispatched** — technician has the work order on their mobile device for today
- **En Route** / **Arrived** — technician is on the way, or on site
- **In Progress** — technician has started
- **Completed** — work finished, ready for verification
- **Cannot Complete** — technician arrived but the job couldn't proceed (no access, unsafe condition, etc.) — needs follow-up
- **No-Show** — the customer was not there
- **Canceled** — canceled before start, by customer or staff

Once an appointment leaves Scheduled it drops off this board. Find it on the
list view.

## From the appointment record

- See the linked Work Order, Project, Property, Building, and Unit
- Reassign the technician via Service Appointment Assignments
- Update status
- Reschedule (which updates the customer-facing time and re-sends confirmation)
- See the activity history including customer-initiated changes

## How Out of Office interacts

When a tech has an **Out of Office** row covering a candidate slot, the
availability engine silently removes that slot from what customers see. You
don't need to intervene — the slot is simply never offered.

Already-scheduled appointments that fall inside a newly-entered absence are
**not** auto-canceled. You need to reassign or reschedule them by hand. Find
them on the **Service Appointments list view**: filter Scheduled Start Time
between the absence's dates and Record Owner to the technician. The inbox has no
filters and is the wrong tool for that job.

## How customer self-service changes show up

When a customer uses their manage link to reschedule or cancel:

- The Service Appointment record updates in place (same record number, new values)
- An activity entry is logged: "rescheduled by customer" or "canceled by customer"
- The slot returns to availability (on cancel)
- An updated confirmation goes out automatically

Press **Refresh** to pick up changes made since the board loaded.
$md$
WHERE ha_record_number = 'HA-00015';

-- ─── HA-00084: list views can now ask a relative date question ───────────────
UPDATE help_articles SET ha_body_markdown = ha_body_markdown ||
$md$

## Relative dates in a filter

A date filter can name a **period** instead of a calendar date. Choose a date
field in **Filters**, pick an operator, and the value box offers Today,
Yesterday, This Week, This Month, This Quarter, This Year, their Last and Next
counterparts, and Last / Next N Days, Weeks, Months or Years — or **Fixed date…**
to enter one specific day.

This matters most for a **saved view**. A view filtered to a fixed date is
correct on the day it is saved and wrong every day after; one filtered to Today
or Last 30 Days is resolved each time the list runs, so it keeps meaning what its
name says. The Service Appointments views (Past / Today's / Upcoming) are built
this way.

Note that a date field with **no value** matches no date comparison at all — a
record with no date is not "before today", it simply has no date. Use **is
blank** to find those.
$md$
WHERE ha_record_number = 'HA-00084';

-- ─── Assertions ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM help_articles
                  WHERE ha_slug = 'service-appointments-list-view'
                    AND ha_is_published AND ha_is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'the service appointment list view article was not published';
  END IF;
  IF (SELECT count(*) FROM help_article_anchors n
        JOIN help_articles a ON a.id = n.haa_article_id
       WHERE a.ha_slug = 'service-appointments-list-view') < 2 THEN
    RAISE EXCEPTION 'the new article is not anchored to the object and the concept';
  END IF;
  -- The instruction that sent people to the wrong screen must be gone.
  IF EXISTS (SELECT 1 FROM help_articles
              WHERE ha_record_number = 'HA-00015'
                AND ha_body_markdown LIKE '%Use this inbox to find them%') THEN
    RAISE EXCEPTION 'HA-00015 still tells the reader to find past work in the inbox';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM help_articles
                  WHERE ha_record_number = 'HA-00084'
                    AND ha_body_markdown LIKE '%Relative dates in a filter%') THEN
    RAISE EXCEPTION 'HA-00084 does not describe relative date filters';
  END IF;
END $$;

COMMIT;
