-- =========================================================================
-- HA-00054 body update: the promised "v1.1 surface" is now live (HA-00055).
-- Replace the forward-looking paragraph with a pointer to the new article.
-- =========================================================================

UPDATE public.help_articles
SET ha_body_markdown = $md$
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

### Where rows are surfaced

Status change events render as first-class entries in the **Activity Timeline** on every record's Activity tab. The entry shows the transition label, the from/to status pills, the record numbers (SCE and ST), and the optional note. See **HA-00055** for the rendering details, the de-duplication pass against field_history, and the dedicated *Status changes* filter chip.

### Cycle-time reports

The intended primary consumer is cycle-time reporting. Joining `status_change_events` to itself by `sce_record_id` and pairing the entry/exit timestamps for each status yields per-record, per-status dwell times. Rolling that up by status, by transition, or by record type produces funnel and pacing reports.

### What's NOT in the table

- **Reverted/failed status change attempts** — only successful changes generate events
- **Status changes applied outside `change_record_status`** — if an admin updates the status column directly via SQL (which they shouldn't), no event row is written. This is by design — `status_change_events` is the "I went through the lifecycle properly" log, not the "the status column changed" log. For the latter, query `audit_log`.
$md$,
ha_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
ha_updated_at = now()
WHERE ha_record_number = 'HA-00054';
