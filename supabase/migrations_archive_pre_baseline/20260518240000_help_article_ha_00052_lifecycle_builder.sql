-- =========================================================================
-- HA-00052 — Setup → Lifecycle Builder, authoring per-object status
-- transition graphs.
-- =========================================================================

WITH new_article AS (
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00052',
    'lifecycle-builder-status-transitions',
    'Setup → Lifecycle Builder: authoring per-object status transition graphs',
    'Each object''s status field can declare which transitions between statuses are allowed. The Lifecycle Builder is where those transitions live — one directed edge per (from-status, to-status) pair, with optional initial-creation transitions and per-row activation, audit, and soft-delete.',
    $md$
The Lifecycle Builder defines the **status_transitions** graph: which status changes are permitted on a record, in which order. Every transition is a directed edge from one picklist value to another within the same picklist field, with a human-readable label like *"Submit for verification"* or *"Approve and dispatch"*.

### Tier 1 — Lifecycle index

The landing view lists every `(object, status_field)` pair that has a status-shaped picklist field. Pairs cluster by object — Work Orders for example shows both `work_order_status` (the main lifecycle) and `work_order_approval_status` (a separate approval state). Each row shows:

- **Active Statuses** — count of active picklist values on this field
- **Active Transitions** — count of active transitions authored against this pair
- **Totals** — only populated when there are inactive statuses or transitions, so the row reads at a glance

Click a row to drill in.

### Tier 2 — Per-lifecycle editor

Two columns:

- **Statuses (left)** — every picklist value on this `(object, status_field)`, in sort order. Inactive statuses appear greyed out so historical transitions still make sense. An extra **(initial creation)** node at the top represents the implicit "no prior status" entry into the lifecycle — transitions originating here apply when a record is first inserted.
- **Transitions (right)** — every authored edge, oldest first within each sort-order group. Each row shows From → To with status pills, the transition label, the optional description, and Edit / Remove actions.

### Authoring a transition

Click **+ New Transition** in the Transitions header. The form takes:

- **From Status** — pick a picklist value, or leave blank for an initial-creation transition. The dropdown shows inactive statuses with an *inactive* suffix so authors can spot them.
- **To Status** — required. Self-loops are rejected client-side and at the database via the `st_no_self_loop` check.
- **Transition Label** — required. Keep it action-oriented per the platform's status-naming convention: *"Submit for verification"*, *"Mark verified"*, *"Cancel and close"*. Avoid generic verbs like *"Update"*.
- **Description** — optional. Use for context the label can't carry: who can trigger it, what evidence it requires, what side effects it has.
- **Sort Order** — controls display order in the Transitions column when multiple transitions exit the same status. Lower numbers sort first.
- **Active** — when false, the transition is hidden from runtime (Automation Builder, validation rules, etc.) but stays in the graph for future restoration.

The form refuses to submit if any of the following are true:

- From and To resolve to the same status (the `st_no_self_loop` constraint)
- A non-deleted transition already exists with this exact (from, to) pair
- The label is blank

These checks run client-side for responsiveness; the same rules are enforced server-side by the `validate_status_transition_endpoints` trigger and the partial unique index.

### Editing and removing

Click **Edit** on a transition row to reopen the same form pre-populated. The duplicate-edge check ignores the row being edited so the form doesn't false-alarm against itself.

**Remove** soft-deletes the row — it disappears from the lifecycle view but remains in the recycle bin and the audit log. Hard deletes are blocked at the database level by the `block_hard_delete` trigger, so accidental destructive operations from any surface (UI, API, SQL) raise an error instead of corrupting the graph.

### Data integrity

Every transition references picklist values via `st_from_status_id` and `st_to_status_id`. A trigger validates on every insert and update that both endpoints actually live on the row's `(st_object, st_status_field)` — preventing a stray Project-status row from being attached to a Work Order transition even if the UUIDs were copy-pasted incorrectly.

The unique constraint covers `(st_object, st_status_field, COALESCE(st_from_status_id, ''00000000-…''), st_to_status_id)` so initial-creation transitions (NULL from-status) participate in deduplication the same way as standard edges.

### What this enables

`status_transitions` is consumed by the rest of the platform:

- **Automation Builder** — when a record's status changes, the automation engine validates the destination is reachable from the current status before firing downstream actions
- **Validation Rules** — rules can scope to specific transitions: *"Block submission unless every required field on the line is populated"* runs only on transitions whose To Status is "Submitted"
- **Page Layouts** — record detail views can show transition buttons matching the outgoing edges of the current status, in the order defined by `st_sort_order`
- **Reporting** — funnels and cycle-time reports use transition timestamps for accurate stage-to-stage measurement

Authoring the graph here is the single source of truth all four consumers read from.
$md$,
    'Setup',
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
  ('route'::text,   '/admin/lifecycle_builder'::text, NULL::text,            NULL::text, NULL::text, 0),
  ('object',        NULL,                              'status_transitions',  NULL,        NULL, 10),
  ('object',        NULL,                              'picklist_values',     NULL,        NULL, 20),
  ('field',         NULL,                              'status_transitions',  'st_object', NULL, 30),
  ('field',         NULL,                              'status_transitions',  'st_status_field', NULL, 35),
  ('field',         NULL,                              'status_transitions',  'st_from_status_id', NULL, 40),
  ('field',         NULL,                              'status_transitions',  'st_to_status_id', NULL, 45),
  ('concept',       NULL,                              NULL,                  NULL, 'status-lifecycle',     5),
  ('concept',       NULL,                              NULL,                  NULL, 'lifecycle-builder',    7),
  ('concept',       NULL,                              NULL,                  NULL, 'status-transitions',   15),
  ('concept',       NULL,                              NULL,                  NULL, 'initial-creation-transition', 25),
  ('concept',       NULL,                              NULL,                  NULL, 'transition-graph',     50)
) AS a(atype, aroute, aobj, afield, aconcept, asort);
