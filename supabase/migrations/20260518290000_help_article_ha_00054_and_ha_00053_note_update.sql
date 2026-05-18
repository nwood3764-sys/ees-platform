-- =========================================================================
-- HA-00053 body update to reflect note field now being supported,
-- plus new HA-00054 covering the status_change_events audit trail.
-- =========================================================================

UPDATE public.help_articles
SET ha_body_markdown = $md$
On any record whose object has a configured lifecycle in **Setup → Lifecycle Builder**, a status transitions bar appears at the top of the record detail page, just below the header and above the tab bar.

### What the bar shows

- **Current status pill** — the record's current value for its lifecycle field (e.g. *Project Status*, *Work Order Status*, *Incentive Application Status*), rendered as a monospace pill so the exact picklist value reads clearly.
- **Transition buttons** — one button per outgoing transition from the current status. The button label is the transition's *action-oriented label* (e.g. "Submit for verification") with the destination status shown beside it in a smaller pill (`→ To Be Verified`).

### Clicking a transition

The bar pops a confirmation modal showing the from-status, to-status, the transition's record number, and the transition description if one was authored. The modal also has an optional **Note** field for adding context that gets captured on the status change event (see HA-00054). Click **Confirm Change** to apply, or **Cancel** to back out.

On confirmation, the platform calls the `change_record_status` RPC. The RPC:

1. Verifies the caller has update permission on the object (via `app_user_can`)
2. Re-reads the record's current status (defending against stale UI state)
3. Looks up the `status_transitions` row matching `(object, status_field, from = current, to = requested)` with `is_active = true` and `is_deleted = false`
4. Refuses the change if no such row exists — meaning the lifecycle was edited mid-session
5. Updates the record's status column plus the standard audit columns (`*_updated_by`, `*_updated_at`)
6. Inserts a `status_change_events` row recording the transition, from/to statuses, the optional note, and the timestamp + user
7. Returns the transition_id used and the new event_id, so the audit trail can be traced back to the exact lifecycle edge that authorized the change

After a successful change, the record re-fetches and the bar updates to show the new status's outgoing transitions.

### When the bar is hidden

The bar self-suppresses in four cases:

1. **The table has no lifecycle yet** — no `status_transitions` rows exist for the object. The record renders normally with no bar.
2. **The table has multiple status fields configured** — some tables (Work Orders, Work Steps) carry both a main lifecycle status and one or more approval-status fields. Surfacing buttons for all of them at once would be ambiguous, so the bar is suppressed until the table declares a primary lifecycle. This is a v1.1 enhancement.
3. **Edit mode is active** — when the user is filling out field changes, a status change here would be confusing and might race the form save.
4. **The current status is terminal** — no outgoing transitions exist. The record is at the end of its lifecycle (e.g. *Project Completed*, *Work Order Closed*).

### Authoring transitions

The buttons that appear here come directly from the **Setup → Lifecycle Builder** graph. To add, edit, or remove a button, edit the corresponding transition row in the Lifecycle Builder — changes propagate immediately on next page load.

### What the bar doesn't do

The bar applies a **status change only**. It doesn't:

- Save unrelated field edits (they need a separate Edit + Save)
- Trigger downstream automation (when Automation Builder lands, status-change events will fire flows; until then, only the status column itself changes)
- Prevent races with concurrent edits (the RPC always validates against the current DB state, so a concurrent change can cause the second click to fail with a clear error — refresh and try again)

### Related

- **Setup → Lifecycle Builder** (HA-00052) — where transitions are authored
- **Status change events** (HA-00054) — the structured audit trail this bar writes to
- **Audit Log** — every status change is also captured by the table's audit trigger as a generic field diff
- **Field History** — the lifecycle field is typically registered for field history, so a per-record timeline of status changes is available
$md$,
ha_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
ha_updated_at = now()
WHERE ha_record_number = 'HA-00053';

-- HA-00054 — status_change_events audit trail
WITH new_article AS (
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00054',
    'status-change-events-audit-trail',
    'status_change_events: structured audit trail for status changes',
    'Every successful change_record_status invocation writes a row to status_change_events. Each row captures the transition that authorized the change, the from/to statuses, the user, the timestamp, and an optional note — distinct from and complementary to the generic audit_log trigger.',
    $md$
The platform captures every status change in three places at once:

1. **The record itself** — the status column gets updated and the audit columns (`*_updated_by`, `*_updated_at`) reflect who and when.
2. **`audit_log`** — the table's generic AFTER UPDATE trigger captures the bare field diff (column name, old value, new value).
3. **`status_change_events`** — a dedicated row linked back to the `status_transitions` edge that authorized the change.

The third capture is what this article covers.

### What gets stored

Each `status_change_events` row contains:

- `sce_record_number` — auto-numbered `SCE-#####`, so events are addressable in reports and queries
- `sce_object` — table name (e.g. `work_orders`)
- `sce_record_id` — uuid of the changed record
- `sce_transition_id` — fk to `status_transitions` — direct traceability to the Lifecycle Builder edge
- `sce_from_status_id` — picklist value the record left (NULL for initial-creation transitions)
- `sce_to_status_id` — picklist value the record entered
- `sce_note` — optional human-authored note from the confirmation modal (NULL if blank)
- `sce_created_at` / `sce_created_by` — when and by whom

The transition_id link means a report can answer questions like *"how many records moved through edge ST-00050 in the last quarter?"* without joining audit_log on string-matched column names.

### How rows are written

The table has no INSERT policy. Direct inserts are rejected. The only path that creates rows is the `change_record_status` RPC, which runs `SECURITY DEFINER` and inserts the row after a successful status update. This means:

- Every event row corresponds to a real authorized transition
- The transition_id on the event always matches the actual lifecycle edge that was active at the moment the change was applied
- There's no path for ad-hoc inserts to pollute the audit trail

### How rows are read

Read access is open to any authenticated user (`USING (true)`). The records themselves carry the granular access control — if a user can read the record, they can see its status history. This matches the audit_log pattern.

### What you'll see eventually

A future v1.1 enhancement will surface `status_change_events` as a section on the record detail page — a chronological timeline of status changes with the note and the user, similar to how field history surfaces today. Until that lands, the events are queryable directly from the `status_change_events` table or via reports.

### Cycle-time reports

The intended primary consumer is cycle-time reporting. Joining `status_change_events` to itself by `sce_record_id` and pairing the entry/exit timestamps for each status yields per-record, per-status dwell times. Rolling that up by status, by transition, or by record type produces funnel and pacing reports.

### What's NOT in the table

- **Reverted/failed status change attempts** — only successful changes generate events
- **Status changes applied outside `change_record_status`** — if an admin updates the status column directly via SQL (which they shouldn't), no event row is written. This is by design — `status_change_events` is the "I went through the lifecycle properly" log, not the "the status column changed" log. For the latter, query `audit_log`.
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
  ('object',        NULL,       'status_transitions',         NULL,        NULL, 20),
  ('field',         NULL,       'status_change_events',       'sce_transition_id', NULL, 30),
  ('field',         NULL,       'status_change_events',       'sce_from_status_id', NULL, 35),
  ('field',         NULL,       'status_change_events',       'sce_to_status_id', NULL, 40),
  ('field',         NULL,       'status_change_events',       'sce_note',  NULL, 45),
  ('concept',       NULL,       NULL,                         NULL, 'status-change-events', 5),
  ('concept',       NULL,       NULL,                         NULL, 'lifecycle-audit-trail', 15),
  ('concept',       NULL,       NULL,                         NULL, 'cycle-time-reports', 25),
  ('concept',       NULL,       NULL,                         NULL, 'change-record-status', 35),
  ('concept',       NULL,       NULL,                         NULL, 'status-history', 50)
) AS a(atype, aroute, aobj, afield, aconcept, asort);
