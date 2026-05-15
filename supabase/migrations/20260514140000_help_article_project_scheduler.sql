-- ─────────────────────────────────────────────────────────────────────────────
-- Help article: Project Scheduler overview
--
-- Standing protocol: every shipped user-facing feature gets a help article in
-- the same session, anchored so HelpIcon surfaces it in context.
--
-- Anchors:
--   • route '/m/field'       → surfaces in the Field module topbar Help button
--   • object 'projects'      → surfaces on any Project record detail
--   • object 'work_orders'   → surfaces on any Work Order record detail
--   • concept 'project-scheduling' / 'bulk-scheduling' → finer-grained HelpIcons
-- ─────────────────────────────────────────────────────────────────────────────

WITH new_article AS (
  INSERT INTO help_articles (
    id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published, ha_is_deleted,
    ha_created_by, ha_created_at
  ) VALUES (
    gen_random_uuid(), '', 'project-scheduler-overview',
    'Project Scheduler — bulk-schedule work orders',
    'How to bulk-schedule unscheduled work orders for a project to a Team Lead across a date range.',
    $BODY$The Project Scheduler is the dispatcher's bulk-allocation tool. When a project has many unscheduled work orders — 100 showerheads at a multifamily property, say — you don't book them one at a time. You select a Team Lead, give the scheduler a date range, and let it lay them down on the crew's calendar.

## When to use it

Use the Project Scheduler when you have **multiple unscheduled work orders on one project** and want to assign them to **one Team Lead**. Typical examples:

- A multifamily direct-install: showerheads, aerators, and thermostats across every unit in a building.
- A small SF retrofit with several measures on one site.
- Rescheduling a batch of work orders that had to be moved.

For one-off appointments where a customer picks their own time (energy assessments, diagnostics), use the customer-facing scheduling page at `/sa/*` or book manually from the Service Appointment record.

## How to use it

From a **Project record**, click the **Schedule** icon in the toolbar (calendar icon, next to Reports). A 4-step wizard opens.

### Step 1 — Select work orders

The wizard lists every work order on this project in status **To Be Scheduled**. By default everything is selected. Uncheck any you want to leave unscheduled for now.

Work orders without a duration are highlighted in amber and **cannot be selected** — the scheduler needs a duration to allocate time. Set a duration on the work type or on the individual work order before scheduling. The per-WO override wins if both are set.

### Step 2 — Pick a Team Lead and date range

Select a Team Lead — contacts whose title starts with "Team Lead" (e.g. *Team Lead — Alpha Crew*). The wizard defaults the date range to next Monday through Friday. Adjust as needed.

The Team Lead's full crew (Lead Tech, Trainees) is **not** auto-assigned in this version — only the Team Lead is added as a Service Appointment Assignment. Add other crew members on each individual SA after scheduling.

### Step 3 — Preview the placement

The scheduler computes the placement and shows you a day-by-day breakdown: which work order will run when, in chronological order. Below the list, a summary card shows total / placed / unplaced counts.

**The algorithm in plain English:**

- Workday is **7:00 AM – 3:30 PM**, with a fixed **11:30 – 12:00 lunch block**. Weekends are skipped.
- Work orders are placed in record-number order. Each work order is placed in the earliest open slot that fits.
- There's a **15-minute buffer** between consecutive work orders for cleanup, staging, and travel within the property.
- Existing scheduled appointments and approved time off for the selected Team Lead are honored — the scheduler won't double-book.
- If a work order doesn't fit before the lunch block, it moves to the afternoon. If it doesn't fit before end-of-day, it tries the next day.
- Work orders that can't be placed within the date range are listed at the bottom with the reason: *Not enough open time in this date range* or *No duration set*.

### Step 4 — Confirm

Clicking **Confirm — schedule N** writes the placements:

- A **Service Appointment** is created for each placed work order with status **Scheduled** and the computed start/end times.
- A **Service Appointment Assignment** is created linking the SA to the Team Lead.
- The work order's status is flipped to **Scheduled** and its scheduled-start fields are populated.

The wizard always runs in **partial-commit mode**: it schedules the work orders that fit and leaves any unplaceable ones in *To Be Scheduled* status. Extend the date range or split into multiple batches if some work orders can't fit.

## Limits

- **One Team Lead per batch.** If half your work orders are going to Alpha Crew and half to Bravo, run the scheduler twice.
- **No travel time between properties** is modeled in v1 — the scheduler assumes a 15-minute inter-WO buffer is enough. For projects that span multiple properties, validate the placement manually before confirming.
- **No optimization.** This is a greedy first-fit allocator, not a constraint optimizer. It places work orders in record-number order, not in a "best" order. If you have a strong preference (e.g. all thermostats first), select the work orders in that order before clicking Schedule, or rearrange afterward via individual SA records.
- **Same-project only.** The wizard only sees work orders on the current project. Cross-project scheduling is a future capability.

## After scheduling

Open the **Field** module to see the new appointments:

- **Service Appointments** inbox shows each newly-created SA. Add additional crew members, edit times, or change status as needed.
- **Schedule** view shows the Team Lead's calendar with each appointment in place.

The work orders themselves now appear in the project's Work Orders related-list with status **Scheduled** and the placement times populated.
$BODY$,
    'Scheduling', 'internal', true, false,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af', now()
  )
  RETURNING id
)
INSERT INTO help_article_anchors (haa_article_id, haa_anchor_type, haa_route, haa_object, haa_concept)
SELECT new_article.id, kind, route_val, object_val, concept_val
  FROM new_article,
       (VALUES
         ('route',   '/m/field',            NULL, NULL),
         ('object',  NULL, 'projects',      NULL),
         ('object',  NULL, 'work_orders',   NULL),
         ('concept', NULL, NULL,            'project-scheduling'),
         ('concept', NULL, NULL,            'bulk-scheduling')
       ) AS a(kind, route_val, object_val, concept_val);