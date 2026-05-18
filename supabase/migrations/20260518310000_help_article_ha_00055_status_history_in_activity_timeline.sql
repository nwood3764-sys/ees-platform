-- =========================================================================
-- HA-00055 — Status changes surfaced in the Activity Timeline
--
-- Closes the audit-trail UX loop flagged in HA-00054. Status changes now
-- render as first-class entries in every record's Activity tab, with the
-- transition label as the headline, the from/to status pills as secondary
-- context, and the optional note rendered inline.
-- =========================================================================

WITH new_article AS (
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00055',
    'status-changes-in-activity-timeline',
    'Status changes in the Activity Timeline',
    'Every successful status change appears as a first-class entry in the record''s Activity tab. The entry shows the transition label, the from/to status pills, and the optional note captured at change time.',
    $md$
The Activity Timeline on every record's **Activity** tab merges four sources of audit data into a single chronological feed:

1. **Field history** — every tracked field change (per the table's field history configuration)
2. **Email sends** — every email sent from the record via the Communications module
3. **Envelope events** — every e-signature envelope lifecycle event (sent, opened, signed, completed, declined, voided)
4. **Status changes** — every successful `change_record_status` invocation, written to `status_change_events` (HA-00054)

This article covers source 4. The other three are covered by their respective audit trails.

### What a status change entry looks like

Each `status_change_events` row renders as a timeline entry with:

- **Avatar + name** of the user who applied the change (joined from `public.users`)
- **Status Changed badge** — a labelled chip identifying the entry kind
- **Relative timestamp** (e.g. *5 min ago*) with full datetime on hover
- **Transition label** as the entry headline (e.g. *Submit for verification*) — pulled from `status_transitions.st_transition_label`
- **From → To status pills** rendered in monospace with the destination status highlighted
- **Record numbers** — the SCE record number and the authorizing transition's record number (e.g. *SCE-00042 · edge ST-00018*) for traceability
- **Note callout** — the optional note captured in the confirmation modal, rendered as a sky-blue left-bar block. Only shown when the note is non-blank.

### De-duplication with field history

Because the lifecycle status column is typically registered for field history tracking, every status change historically produced **two** entries in the timeline:

1. A bare `Status: New → To Be Scheduled` change row (from `field_history`)
2. The structured status change event row (from `status_change_events`)

The timeline now de-duplicates these. When a `status_change_event` and a `field_history` row match on:

- The same record
- A timestamp within 5 seconds of each other
- The `field_history` row's column matches the `status_change_event`'s `sce_status_field`

…the bare field_history change row is suppressed in favor of the richer status change entry. If the field_history update batch contained *only* that one change, the entire batch entry is dropped. If it contained other tracked changes too (e.g. an owner reassignment that happened in the same save), the status change row is removed but the rest of the batch is preserved.

This means: the lifecycle status column's changes show up once in the timeline, with the transition label and note, not twice with redundant content.

### Filter chip

The Activity Timeline includes a **Status changes** filter chip alongside *All*, *Field changes*, and *Created / Deleted*. Clicking it filters the feed to status_change entries only — useful for reading the full lifecycle progression of a record at a glance.

### What's not surfaced here

- **Failed status change attempts** — the RPC validates and rejects invalid moves. No event row is written on failure, so nothing renders.
- **Direct SQL updates to status columns** — if a status column is changed outside `change_record_status` (which shouldn't happen), no event row exists. The bare field_history "Status: A → B" change row still renders, but without the transition label or note. This is the intended fallback: the timeline always reflects reality.
- **Status changes on soft-deleted SCE rows** — the read RPC filters `sce_is_deleted = false`. If an event is soft-deleted, it disappears from the timeline.

### Related

- **HA-00053** — StatusTransitionsBar widget (where users initiate status changes)
- **HA-00054** — status_change_events table schema and write rules
- **HA-00052** — Lifecycle Builder (where transitions and their labels are authored)
$md$,
    'Records',
    'internal',
    true,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af'
  )
  RETURNING id
)
INSERT INTO public.help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order, haa_created_by
)
SELECT new_article.id, a.atype, a.aroute, a.aobj, a.afield, a.aconcept, a.asort, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
FROM new_article,
LATERAL (VALUES
  ('object'::text,  NULL::text, 'status_change_events'::text, NULL::text, NULL::text, 10),
  ('concept',       NULL,       NULL,                         NULL, 'activity-timeline', 5),
  ('concept',       NULL,       NULL,                         NULL, 'status-history', 15),
  ('concept',       NULL,       NULL,                         NULL, 'status-history-timeline', 20),
  ('concept',       NULL,       NULL,                         NULL, 'audit-trail', 25),
  ('concept',       NULL,       NULL,                         NULL, 'timeline-deduplication', 30),
  ('concept',       NULL,       NULL,                         NULL, 'status-change-filter', 35)
) AS a(atype, aroute, aobj, afield, aconcept, asort);
