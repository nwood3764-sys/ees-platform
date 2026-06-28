-- ─────────────────────────────────────────────────────────────────────────────
-- Help articles for the EES scheduling system (master ea585ca).
--
-- Four articles, all internal-audience (staff-facing). They cover:
--   1. customer-scheduling-overview — what customers see at /sa and what the
--      cascade creates on our side
--   2. service-appointments-inbox   — the Field → Service Appointments inbox
--   3. out-of-office-overview       — logging PTO/training/sick via
--      resource_absences and how it affects customer availability
--   4. manage-link-overview         — the /sa/manage/<token> self-serve
--      reschedule + cancel flow, for staff handling customer questions
--
-- Anchors surface them in three ways:
--   • route '/m/field'             → all four surface via the topbar Help button
--     when the user is anywhere in the Field module
--   • object 'service_appointments' → SA-related articles surface on any SA
--     record detail
--   • object 'resource_absences'   → Out of Office surfaces on any absence
--     record detail
--   • concept anchors              → finer-grained HelpIcons placed inline
--     (e.g. next to the Service Appointments inbox header)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Customer self-scheduling overview ───────────────────────────────────────
INSERT INTO help_articles (
  id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published, ha_is_deleted,
  ha_created_by, ha_created_at
) VALUES (
  gen_random_uuid(), '', 'customer-scheduling-overview',
  'How Customer Self-Scheduling Works',
  'What customers see at /sa, which assessment types are publicly schedulable, and the full record cascade that gets created when they confirm.',
$BODY$Customers can book their own energy assessments at our public scheduling pages — no phone call to dispatch. This article explains what they see, which work types are open to the public, and what gets created on our side when they confirm.

## The customer-facing URLs

- **`/sa`** — catalog of available assessment types
- **`/sa/<slug>`** — the scheduling flow for a specific type (intake → slots → confirm → success)
- **`/sa/manage/<token>`** — the customer's self-serve reschedule/cancel page (see "Self-Serve Reschedule and Cancel")

## Which work types are publicly schedulable

Only work types with `work_type_is_publicly_schedulable = true` appear in the public catalog. Today that's four assessments:

- **WT-00072** — Single-Family Energy Assessment (90 min)
- **WT-00073** — Townhome Energy Assessment (30 min)
- **WT-00074** — Multifamily Energy Assessment (60 min)
- **WT-00075** — Multifamily Diagnostic Assessment (120 min)

Everything else is dispatcher-only. To make a new work type publicly schedulable, set the flag on the Work Type record and give it a public slug.

## What the customer enters

A lean intake form: first name, last name, email, phone, and address (street, city, state, ZIP). Then they pick a time slot from what the availability engine offers.

## What gets created when they confirm

A complete cascade, all owned end-to-end. No record is ever left without an owner:

**Property → Building → Unit → Opportunity → Project → Work Order → Service Appointment → Service Appointment Assignment → Service Appointment Token**

For single-family and townhome the cascade creates one Building and one Unit. Multifamily expansion (per-unit intake) is on the backlog.

## Who gets assigned

The availability engine assigns based on work type:

- **Single-Family + Townhome** — Javier or Kenji, whoever has the slot open
- **Multifamily (both types)** — Kenji only

Multifamily is a single point of failure today. Onboarding a second multifamily assessor is on the roadmap.

## What the customer gets back

A confirmation page with the appointment details and a unique manage link (`/sa/manage/<token>`). The token is bound to that specific Service Appointment record and lets the customer reschedule or cancel without calling.

## Where to find the appointment after it's booked

- Field module → **Service Appointments** inbox (default view: Upcoming & Active)
- Drill in from the new Property record
- Drill in from the auto-created Project
- Drill in from the underlying Work Order
$BODY$,
  'Scheduling', 'internal', true, false,
  'c5a01ec8-960f-42ab-8a9e-a49822de89af', now()
);

-- 2. Service Appointments inbox ──────────────────────────────────────────────
INSERT INTO help_articles (
  id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published, ha_is_deleted,
  ha_created_by, ha_created_at
) VALUES (
  gen_random_uuid(), '', 'service-appointments-inbox',
  'The Service Appointments Inbox',
  'How to use the Field → Service Appointments inbox: status meanings, what to do on a row, and how Out of Office and customer self-service changes flow back in.',
$BODY$The Service Appointments inbox is the single working surface for everything customers have booked themselves at `/sa` plus anything dispatch has scheduled manually. Live at **Field → Service Appointments**.

## What you see

Every row is one Service Appointment, grouped by day (Chicago calendar time). Default window is the next 14 days; the dropdown switches between 7 / 14 / 30 / 60 days.

Each row shows the time, customer name and contact, work type and location, and the assigned technician.

## Status meanings

Six statuses, in the order they typically progress:

- **Scheduled** — confirmed slot, technician assigned, customer notified
- **Dispatched** — technician has the work order on their mobile device for today
- **In Progress** — technician has arrived and started
- **Completed** — work finished, ready for verification
- **Cannot Complete** — technician arrived but the job couldn't proceed (no access, unsafe condition, etc.) — needs follow-up
- **Canceled** — canceled before start, by customer or staff

## Click into a row

The standard RecordDetail opens. From the SA record you can:

- See the linked Work Order, Project, Property, Building, and Unit
- Reassign the technician via Service Appointment Assignments
- Update status
- Reschedule (which updates the customer-facing time and re-sends confirmation)
- See the activity history including customer-initiated changes

## How Out of Office interacts

When a tech has an **Out of Office** row covering a candidate slot, the availability engine silently removes that slot from what customers see. You don't need to manually intervene — the slot is simply never offered.

Already-scheduled appointments that fall inside a newly-entered absence are **not** auto-canceled. You need to manually reassign or reschedule them. Use this inbox to find them — filter by date range, then check the assigned tech against the absence.

## How customer self-service changes show up

When a customer uses their manage link to reschedule or cancel:

- The Service Appointment record updates in place (same record number, new values)
- An activity entry is logged: "rescheduled by customer" or "canceled by customer"
- The slot returns to availability (on cancel)
- An updated confirmation goes out automatically

You'll see these changes reflected on next inbox refresh.
$BODY$,
  'Scheduling', 'internal', true, false,
  'c5a01ec8-960f-42ab-8a9e-a49822de89af', now()
);

-- 3. Out of Office overview ──────────────────────────────────────────────────
INSERT INTO help_articles (
  id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published, ha_is_deleted,
  ha_created_by, ha_created_at
) VALUES (
  gen_random_uuid(), '', 'out-of-office-overview',
  'Out of Office — PTO, Training, Sick Time',
  'How to log a technician absence so the customer scheduling engine stops offering their slots. Covers required fields, what happens after you save, and the existing-appointment caveat.',
$BODY$Out of Office is where you log every reason a technician is unavailable — PTO, training, sick time, jury duty, anything that should block them from being offered to customers at `/sa`.

## Where to enter one

**Field → Out of Office → New.** Standard RecordDetail form. You can also add an absence directly from any technician's contact record.

## Required fields

- **Contact** — the technician
- **Start datetime** and **End datetime** — exact, to the minute
- **Absence type** — PTO, Training, Sick, etc. (free-form today)
- **Is all day** — optional flag for full-day blocks
- **Notes** — optional context for other staff

## What happens after you save

The customer scheduling engine reads `resource_absences` on every availability request. Any candidate slot that overlaps the `[start_datetime, end_datetime]` window is silently excluded from what customers see at `/sa/<slug>`.

Already-scheduled appointments that fall inside the new absence window are **not** auto-canceled. The system has no way to know your intent — you might be planning to reassign, or the customer might have already been called and rescheduled outside the system. Use the Service Appointments inbox to find affected appointments and reschedule them manually.

## Best practice

- **Enter absences as soon as you know about them.** The further out, the cleaner the customer experience. A slot that gets offered and then has to be reassigned creates two confirmation emails for the customer instead of one.
- **For half-days, use exact times.** The scheduler honors the minute.
- **For recurring absences** (weekly training, every Friday off), enter each occurrence as a separate row for now. A recurrence builder is on the backlog.

## Who sees absences

All internal staff can see all Out of Office rows. Customers never see them directly — they just see fewer or different slots offered.

## Soft delete

Like every other record, deleting an absence moves it to the recycle bin. The scheduling engine excludes deleted rows from its overlap check, so deleting an absence restores those slots to availability immediately.
$BODY$,
  'Scheduling', 'internal', true, false,
  'c5a01ec8-960f-42ab-8a9e-a49822de89af', now()
);

-- 4. Manage link / self-serve reschedule + cancel ────────────────────────────
INSERT INTO help_articles (
  id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published, ha_is_deleted,
  ha_created_by, ha_created_at
) VALUES (
  gen_random_uuid(), '', 'manage-link-overview',
  'Self-Serve Reschedule and Cancel — The Manage Link',
  'How the /sa/manage/<token> link works, what customers can do with it, and how to troubleshoot when a customer says their link does not work.',
$BODY$Every Service Appointment confirmation includes a unique manage link of the form **`/sa/manage/<token>`**. Customers use this link to reschedule or cancel themselves — no phone call needed.

## What the customer can do

- **View** their appointment details
- **Reschedule** — pick a new slot from the same availability window the original booking pulled from
- **Cancel** — moves the appointment to status **Canceled**

The page is mobile-friendly and intentionally minimal — the customer doesn't need a login.

## Token mechanics

The token is bound to one specific Service Appointment record. It stays valid until the original scheduled appointment time arrives, at which point it expires. After expiry, the customer would need to schedule fresh from `/sa`.

When the customer reschedules, the token continues to work — they can reschedule again from the same link if needed. Each change writes an activity entry to the underlying Service Appointment record.

## What changes in our system on a customer-initiated reschedule

- The Service Appointment record updates in place — same `id`, same record number, new `sa_scheduled_start` and `sa_scheduled_end`
- Service Appointment Assignment(s) are reconfirmed against the new slot (re-runs assignment logic if needed)
- An activity entry is logged with timestamp and "rescheduled by customer"
- A fresh confirmation email goes out automatically

## What changes on a customer-initiated cancel

- Status moves to **Canceled**
- The slot returns to availability
- An activity entry is logged with "canceled by customer via manage link"

## Troubleshooting a "my link doesn't work" call

If a customer says their link isn't working:

1. **Check whether the appointment is in the past.** Token will be expired. Schedule fresh from `/sa`.
2. **Check whether the record was deleted** (recycle bin). The token is bound to a live record — restore the SA from recycle bin if appropriate, or have the customer reschedule.
3. **Look up the token on the SA record.** The token value lives on the Service Appointment Token related record. You can resend the confirmation from there.

## When to override

You can always reschedule or cancel on behalf of the customer from the Service Appointment record. The manage link is a convenience for the customer — it doesn't restrict what staff can do. Staff actions are logged the same way ("rescheduled by Nicholas Wood" instead of "by customer").
$BODY$,
  'Scheduling', 'internal', true, false,
  'c5a01ec8-960f-42ab-8a9e-a49822de89af', now()
);

-- ─── Anchors ─────────────────────────────────────────────────────────────────
-- All four articles surface via the Field module route. SA-related articles
-- also surface via the service_appointments object anchor; absences via
-- resource_absences. Concept anchors enable inline HelpIcon placement.

WITH a AS (
  SELECT id, ha_slug FROM help_articles
  WHERE ha_slug IN (
    'customer-scheduling-overview',
    'service-appointments-inbox',
    'out-of-office-overview',
    'manage-link-overview'
  )
)
INSERT INTO help_article_anchors (
  id, haa_article_id, haa_anchor_type, haa_route, haa_object, haa_concept,
  haa_sort_order, haa_created_at, haa_created_by
)
SELECT gen_random_uuid(), a.id, t.anchor_type, t.route, t.object, t.concept,
       t.sort_order, now(), 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM a
JOIN (VALUES
  -- customer-scheduling-overview
  ('customer-scheduling-overview', 'route',   '/m/field',             NULL,                  NULL,                       1),
  ('customer-scheduling-overview', 'object',  NULL,                   'service_appointments', NULL,                       2),
  ('customer-scheduling-overview', 'concept', NULL,                   NULL,                  'customer-scheduling',      3),
  ('customer-scheduling-overview', 'concept', NULL,                   NULL,                  'service-appointment',      4),

  -- service-appointments-inbox
  ('service-appointments-inbox',   'route',   '/m/field',             NULL,                  NULL,                       1),
  ('service-appointments-inbox',   'object',  NULL,                   'service_appointments', NULL,                       2),
  ('service-appointments-inbox',   'concept', NULL,                   NULL,                  'service-appointments-inbox', 3),
  ('service-appointments-inbox',   'concept', NULL,                   NULL,                  'service-appointment',      4),

  -- out-of-office-overview
  ('out-of-office-overview',       'route',   '/m/field',             NULL,                  NULL,                       1),
  ('out-of-office-overview',       'object',  NULL,                   'resource_absences',   NULL,                       2),
  ('out-of-office-overview',       'concept', NULL,                   NULL,                  'out-of-office',            3),
  ('out-of-office-overview',       'concept', NULL,                   NULL,                  'availability',             4),

  -- manage-link-overview
  ('manage-link-overview',         'route',   '/m/field',             NULL,                  NULL,                       1),
  ('manage-link-overview',         'object',  NULL,                   'service_appointments', NULL,                       2),
  ('manage-link-overview',         'concept', NULL,                   NULL,                  'manage-link',              3),
  ('manage-link-overview',         'concept', NULL,                   NULL,                  'appointment-management',   4)
) t(slug, anchor_type, route, object, concept, sort_order)
ON a.ha_slug = t.slug;
